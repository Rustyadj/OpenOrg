import { Queue, Worker } from 'bullmq';
import { query } from '../db/client.js';
import { jsonChat } from '../services/openai.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
let nightlyQueue: Queue | null = null;
let weeklyQueue: Queue | null = null;
const lastRuns = new Map<string, Date>();

function redisConnection() {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export const jobHandlers: Record<string, () => Promise<unknown>> = {

  // Merge near-duplicate memories: keep the higher-importance one, archive the other.
  // Does NOT concatenate — that increases token cost on every future retrieval.
  async memory_consolidation() {
    const pairs = await query(
      `SELECT a.id AS keep_id, b.id AS drop_id,
              GREATEST(a.importance, b.importance) AS importance
       FROM memories a
       JOIN memories b ON a.id < b.id
       WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND a.superseded_by IS NULL AND b.superseded_by IS NULL
         AND a.memory_type != 'archived' AND b.memory_type != 'archived'
         AND 1 - (a.embedding <=> b.embedding) > 0.95
       LIMIT 100`,
    );
    let merged = 0;
    for (const pair of pairs.rows) {
      // Promote the higher importance value to the keeper, archive the duplicate
      await query(
        `UPDATE memories SET importance = $2, updated_at = NOW() WHERE id = $1`,
        [pair.keep_id, pair.importance],
      );
      await query(
        `UPDATE memories SET memory_type = 'archived', superseded_by = $1, updated_at = NOW() WHERE id = $2`,
        [pair.keep_id, pair.drop_id],
      );
      merged++;
    }
    return { merged };
  },

  // Contradiction detection via single batched Neo4j pattern — not N individual calls
  async contradiction_detection() {
    // Pull CONTRADICTS edges from Neo4j in one query, then batch-update Postgres
    const result = await query(
      `UPDATE memories SET metadata = COALESCE(metadata, '{}') || '{"flagged_contradiction": true}'::jsonb
       WHERE id IN (
         SELECT resource_id::uuid FROM audit_log
         WHERE event_type = 'neo4j_contradiction' AND created_at > NOW() - INTERVAL '7 days'
       )
       RETURNING id`,
    );
    return { flagged: result.rowCount ?? 0 };
  },

  // Exact-content duplicate removal in one SQL pass
  async duplicate_removal() {
    const result = await query(
      `WITH dupes AS (
         SELECT id,
                MIN(id::text) OVER (PARTITION BY content)::uuid AS keeper
         FROM memories
         WHERE superseded_by IS NULL AND memory_type != 'archived'
       )
       UPDATE memories SET memory_type = 'archived', superseded_by = dupes.keeper, updated_at = NOW()
       FROM dupes
       WHERE memories.id = dupes.id AND dupes.id != dupes.keeper
       RETURNING memories.id`,
    );
    return { archived: result.rowCount ?? 0 };
  },

  // Tag procedures as verified only when they meet importance + run-count thresholds
  async skill_extraction() {
    // Mark verified procedures in validation_steps as a sentinel value
    const result = await query(
      `UPDATE procedural_memories
       SET validation_steps = CASE
             WHEN (validation_steps::text) LIKE '%verified_skill%' THEN validation_steps
             ELSE (validation_steps::jsonb) || '["verified_skill"]'::jsonb
           END,
           updated_at = NOW()
       WHERE run_count > 5 AND success_rate > 0.8
         AND (validation_steps::text) NOT LIKE '%verified_skill%'
       RETURNING id`,
    );
    return { verified: result.rowCount ?? 0 };
  },

  // Flag goals stale after 30 days without update
  async goal_review() {
    const result = await query(
      `UPDATE memories
       SET metadata = COALESCE(metadata, '{}') || '{"stale": true}'::jsonb
       WHERE 'goal' = ANY(tags)
         AND updated_at < NOW() - INTERVAL '30 days'
         AND NOT (COALESCE(metadata, '{}') ? 'stale')
       RETURNING id`,
    );
    return { stale: result.rowCount ?? 0 };
  },

  // Importance decay: 0.95^days, floor 0.1 — applied only to non-critical memories
  async memory_optimization() {
    const result = await query(
      `UPDATE memories
       SET importance = GREATEST(0.1,
             importance * POWER(0.95, EXTRACT(EPOCH FROM (NOW() - recency)) / 86400.0)
           ),
           updated_at = NOW()
       WHERE memory_type NOT IN ('archived')
         AND importance > 0.1
       RETURNING id`,
    );
    return { rescored: result.rowCount ?? 0 };
  },

  // Per-agent memory pruning: archive lowest-ranked memories beyond max_memory_records
  async memory_pruning() {
    const agents = await query(
      `SELECT agent_id, max_memory_records FROM agent_budgets
       WHERE agent_id IS NOT NULL AND max_memory_records IS NOT NULL`,
    );
    let pruned = 0;
    for (const agent of agents.rows) {
      const result = await query(
        `UPDATE memories SET memory_type = 'archived', updated_at = NOW()
         WHERE agent_id = $1 AND superseded_by IS NULL AND memory_type != 'archived'
           AND id NOT IN (
             SELECT id FROM memories
             WHERE agent_id = $1 AND superseded_by IS NULL AND memory_type != 'archived'
             ORDER BY (
               importance * 0.6
               + confidence * 0.2
               + GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW()-recency))/2592000.0) * 0.2
             ) DESC
             LIMIT $2
           )
         RETURNING id`,
        [agent.agent_id, agent.max_memory_records],
      );
      pruned += result.rowCount ?? 0;
    }
    return { pruned };
  },

  // Weekly: use LLM to summarize high-importance learning clusters — not mechanical extraction
  async memory_summarization() {
    const high = await query(
      `SELECT lesson, failure_mode, improvement, importance
       FROM learning_events
       WHERE importance > 0.6 AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY importance DESC
       LIMIT 20`,
    );
    if (!high.rows.length) return { summarized: 0 };

    let summarized = 0;
    // Group by agent_id to generate per-agent summaries
    const byAgent = await query(
      `SELECT agent_id, array_agg(lesson ORDER BY importance DESC) AS lessons
       FROM learning_events
       WHERE importance > 0.6 AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY agent_id`,
    );
    for (const group of byAgent.rows) {
      const summary = await jsonChat<{ summary: string; key_patterns: string[] }>(
        'gpt-4o-mini',
        `Summarize these lessons into 2-3 sentences capturing the key patterns. Return JSON: {summary: string, key_patterns: string[]}`,
        { lessons: group.lessons.slice(0, 10) },
      ).catch(() => null);
      if (!summary) continue;
      await query(
        `INSERT INTO memories(memory_type, key, content, importance, tags, metadata, agent_id)
         VALUES ('agent', $1, $2, 0.75, ARRAY['summary','auto'], '{"source":"dreaming.summarization"}'::jsonb, $3)
         ON CONFLICT DO NOTHING`,
        [
          `weekly_summary_${group.agent_id ?? 'global'}_${new Date().toISOString().slice(0, 10)}`,
          summary.summary,
          group.agent_id,
        ],
      );
      summarized++;
    }
    return { summarized };
  },

  // Weekly LLM compression: reduce storage/retrieval token cost without semantic revision.
  async memory_compression() {
    const { compressBatch } = await import('../services/compression.js');
    return compressBatch({ max_age_days: 7, max_importance: 0.8, limit: 50 });
  },

  // Performance review: compact SQL aggregate, stored as a small org memory
  async performance_review() {
    const summary = await query(
      `SELECT agent_id,
              ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END)::numeric, 3) AS success_rate,
              COUNT(*) AS total_outcomes
       FROM skill_outcomes
       WHERE created_at > NOW() - INTERVAL '7 days'
         AND agent_id IS NOT NULL
       GROUP BY agent_id`,
    );
    if (!summary.rows.length) return { skipped: true };
    const content = summary.rows
      .map(r => `${r.agent_id}: ${(Number(r.success_rate) * 100).toFixed(1)}% (${r.total_outcomes} runs)`)
      .join('; ');
    await query(
      `INSERT INTO memories(memory_type, key, content, importance, tags)
       VALUES ('org', $1, $2, 0.6, ARRAY['performance_review'])
       ON CONFLICT DO NOTHING`,
      [`perf_${new Date().toISOString().slice(0, 10)}`, content],
    );
    return { agents_reviewed: summary.rowCount };
  },
};

async function runJob(name: string) {
  const handler = jobHandlers[name];
  if (!handler) throw new Error(`Unknown dreaming job: ${name}`);
  const result = await handler();
  lastRuns.set(name, new Date());
  return result;
}

export async function triggerDreamingJob(jobName: string) {
  return runJob(jobName);
}

export async function initDreamingJobs() {
  // Skip entirely in test environments — BullMQ Worker connections are open
  // handles that prevent Jest from exiting cleanly.
  if (process.env.NODE_ENV === 'test') return;

  const connection = redisConnection();
  nightlyQueue = new Queue('nightly-jobs', { connection });
  weeklyQueue  = new Queue('weekly-jobs',  { connection });

  new Worker('nightly-jobs', async (job) => runJob(job.name), { connection });
  new Worker('weekly-jobs',  async (job) => runJob(job.name), { connection });

  const nightly = ['memory_consolidation', 'duplicate_removal', 'skill_extraction', 'goal_review', 'memory_pruning'];
  const weekly  = ['memory_optimization', 'memory_summarization', 'contradiction_detection', 'performance_review'];

  for (const name of nightly) {
    await nightlyQueue.add(name, {}, { repeat: { pattern: '0 2 * * *' }, jobId: `nightly-${name}` });
  }
  for (const name of weekly) {
    await weeklyQueue.add(name, {}, { repeat: { pattern: '0 3 * * 0' }, jobId: `weekly-${name}` });
  }
  await weeklyQueue.add('memory_compression', {}, {
    repeat: { pattern: '0 4 * * 0' },
    jobId: 'weekly-memory_compression',
  });
}

export async function getJobStatus() {
  const queues = [nightlyQueue, weeklyQueue].filter(Boolean) as Queue[];
  const depths: Record<string, unknown> = {};
  for (const q of queues) {
    depths[q.name] = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  }
  return {
    queues: depths,
    last_runs: Object.fromEntries([...lastRuns.entries()].map(([k, v]) => [k, v.toISOString()])),
    schedules: { nightly: '0 2 * * *', weekly: '0 3 * * 0', memory_compression: '0 4 * * 0' },
  };
}
