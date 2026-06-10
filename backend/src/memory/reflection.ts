import { Queue, Worker } from 'bullmq';
import { query } from '../db/client.js';
import { detectContradictions } from './contradiction.js';
import { ensureMemoryQualitySchema, rowToMemoryRecord, type ReflectionLog } from './types.js';

let reflectionQueue: Queue | null = null;
let reflectionWorker: Worker | null = null;

/** Runs the daily memory reflection pass and writes a summary row to memory_reflection_log. */
export async function runMemoryReflection(): Promise<ReflectionLog> {
  await ensureMemoryQualitySchema();
  const memoriesMerged = await mergeDuplicates();
  const confidenceUpdates = await updateConfidence();
  const archived = await archiveLowImportance();
  const contradictionsFound = await detectRecentContradictions();

  const result = await query(
    `INSERT INTO memory_reflection_log(run_at, memories_merged, confidence_updates, contradictions_found, archived)
     VALUES (NOW(),$1,$2,$3,$4)
     RETURNING *`,
    [memoriesMerged, confidenceUpdates, contradictionsFound, archived],
  );
  const row = result.rows[0];
  return {
    runAt: new Date(row.run_at),
    memoriesMerged: row.memories_merged,
    confidenceUpdates: row.confidence_updates,
    contradictionsFound: row.contradictions_found,
    archived: row.archived,
  };
}

/** Schedules reflection every 24 hours through BullMQ. */
export async function scheduleMemoryReflection(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const connection = redisConnection();
  reflectionQueue = new Queue('memory-reflection', { connection });
  reflectionWorker = new Worker('memory-reflection', runMemoryReflection, { connection });
  await reflectionQueue.add('runMemoryReflection', {}, { repeat: { pattern: '0 1 * * *' }, jobId: 'daily-memory-reflection' });
}

/** Stops the reflection queue and worker, primarily for graceful shutdown. */
export async function closeMemoryReflectionScheduler(): Promise<void> {
  await reflectionWorker?.close();
  await reflectionQueue?.close();
  reflectionWorker = null;
  reflectionQueue = null;
}

async function mergeDuplicates(): Promise<number> {
  const pairs = await query(
    `SELECT a.id AS keep_id, b.id AS drop_id
     FROM memories a
     JOIN memories b ON a.id < b.id
     WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
       AND a.superseded_by IS NULL AND b.superseded_by IS NULL
       AND a.memory_type != 'archived' AND b.memory_type != 'archived'
       AND COALESCE(a.metadata->>'category','') = COALESCE(b.metadata->>'category','')
       AND 1 - (a.embedding <=> b.embedding) > 0.85
       AND COALESCE(a.metadata->>'category','') != 'Decision'
     LIMIT 100`,
  );
  let merged = 0;
  for (const pair of pairs.rows) {
    await query(
      `UPDATE memories
       SET confidence = LEAST(1, confidence + 0.05),
           metadata = COALESCE(metadata, '{}') || jsonb_build_object('mergedDuplicateId', $2::text),
           updated_at = NOW()
       WHERE id = $1`,
      [pair.keep_id, pair.drop_id],
    );
    await query(
      `UPDATE memories SET memory_type = 'archived', superseded_by = $1, updated_at = NOW() WHERE id = $2`,
      [pair.keep_id, pair.drop_id],
    );
    merged++;
  }
  return merged;
}

async function updateConfidence(): Promise<number> {
  const confirmed = await query(
    `UPDATE memories
     SET confidence = LEAST(1, confidence + 0.05), updated_at = NOW()
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND cardinality(string_to_array(COALESCE(source,''), ',')) > 1
     RETURNING id`,
  );
  const stale = await query(
    `UPDATE memories
     SET confidence = GREATEST(0, confidence - 0.05), updated_at = NOW()
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND COALESCE(metadata->>'category','') != 'Decision'
       AND updated_at < NOW() - INTERVAL '30 days'
     RETURNING id`,
  );
  return (confirmed.rowCount ?? 0) + (stale.rowCount ?? 0);
}

async function archiveLowImportance(): Promise<number> {
  const result = await query(
    `UPDATE memories
     SET memory_type = 'archived', updated_at = NOW()
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND COALESCE(metadata->>'category','') != 'Decision'
       AND importance < 0.3
     RETURNING id`,
  );
  return result.rowCount ?? 0;
}

async function detectRecentContradictions(): Promise<number> {
  const result = await query(
    `SELECT * FROM memories
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND updated_at > NOW() - INTERVAL '24 hours'
     LIMIT 100`,
  );
  let count = 0;
  for (const row of result.rows) count += (await detectContradictions(rowToMemoryRecord(row))).length;
  return count;
}

function redisConnection() {
  const parsed = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}
