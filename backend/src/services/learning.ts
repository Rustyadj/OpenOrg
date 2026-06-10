import crypto from 'node:crypto';
import { query } from '../db/client.js';
import { createRelationship } from './graph.js';
import { jsonChat } from './openai.js';

type ExtractedLearning = {
  lesson: string;
  failure_mode?: string;
  improvement?: string;
  importance: number;
};

async function getAgentLearningConfig(agentId?: string): Promise<{ enabled: boolean; threshold: number }> {
  if (!agentId) return { enabled: true, threshold: 0.6 };
  const result = await query(
    `SELECT learning_enabled, learning_threshold FROM agent_budgets WHERE agent_id = $1`,
    [agentId],
  );
  if (!result.rows[0]) return { enabled: true, threshold: 0.6 };
  return {
    enabled:   result.rows[0].learning_enabled  ?? true,
    threshold: result.rows[0].learning_threshold ?? 0.6,
  };
}

export async function reviewOutcome(
  action: string,
  outcome: string,
  context: object,
  agentId?: string,
) {
  const config = await getAgentLearningConfig(agentId);
  if (!config.enabled) return null;

  const extracted = await jsonChat<ExtractedLearning>(
    'gpt-4o-mini',
    `Extract a learning event as JSON with exactly these fields:
- lesson (string, max 200 chars, the core reusable insight)
- failure_mode (string or null, what went wrong if applicable)
- improvement (string or null, what to do differently)
- importance (float 0-1, how broadly applicable and valuable this lesson is)

Be conservative with importance. Routine successes score below 0.4. Novel failures or insights worth reusing score above 0.6. Return raw JSON only.`,
    { action, outcome, context },
  );

  const importance = Number(extracted.importance ?? 0);
  if (importance < config.threshold) return null;

  // Hash on normalized lesson text — prevents storing the same insight twice
  const contentHash = crypto
    .createHash('sha256')
    .update(extracted.lesson.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);

  try {
    const result = await query(
      `INSERT INTO learning_events(action, outcome, lesson, failure_mode, improvement, importance, context, agent_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       ON CONFLICT (content_hash) DO UPDATE
         SET importance = GREATEST(learning_events.importance, EXCLUDED.importance)
       RETURNING *`,
      [
        action, outcome,
        extracted.lesson,
        extracted.failure_mode ?? null,
        extracted.improvement  ?? null,
        importance,
        JSON.stringify(context),
        agentId ?? null,
        contentHash,
      ],
    );
    const event = result.rows[0];
    if (agentId) {
      await createRelationship(agentId, 'Agent', event.id, 'LearningEvent', 'LEARNED', { importance })
        .catch(() => null);
    }
    return event;
  } catch {
    return null; // conflict = duplicate lesson, not an error
  }
}

export async function getRecentLessons(limit = 20) {
  const result = await query(
    `SELECT * FROM learning_events ORDER BY importance DESC, created_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}

export async function getLessonsByAgent(agentId: string) {
  const result = await query(
    `SELECT * FROM learning_events WHERE agent_id = $1 ORDER BY importance DESC, created_at DESC`,
    [agentId],
  );
  return result.rows;
}
