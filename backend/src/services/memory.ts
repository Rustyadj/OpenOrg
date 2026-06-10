import { query } from '../db/client.js';
import { embed } from './embed.js';

export type MemoryInput = {
  memory_type: string;
  key: string;
  content: string;
  embedding?: number[];
  importance?: number;
  confidence?: number;
  source?: string;
  workspace_id?: string;
  agent_id?: string;
  org_id?: string;
  project_id?: string;
  user_id?: string;
  chat_id?: string;
  category?: string;
  memory_tier?: string;
  importance_score?: number;
  confidence_score?: number;
  expiration_policy?: string;
  tags?: string[];
  metadata?: object;
  version?: number;
};

export type SearchOptions = {
  limit?: number;
  memory_type?: string;
  workspace_id?: string;
  agent_id?: string;
  org_id?: string;
  project_id?: string;
  user_id?: string;
  chat_id?: string;
  max_tokens?: number; // hard token budget for returned set
};

function vectorLiteral(embedding?: number[]) {
  return embedding ? `[${embedding.join(',')}]` : null;
}

function tagsLiteral(tags?: string[]): string {
  if (!tags || tags.length === 0) return '{}';
  return '{' + tags.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',') + '}';
}

export async function createMemory(input: MemoryInput) {
  // Embed the content if not provided
  const embeddingVec = input.embedding ?? await embed(input.content);

  const result = await query(
    `INSERT INTO memories(
       memory_type, key, content, embedding, importance, confidence,
       source, workspace_id, agent_id, org_id, project_id, user_id,
       category, memory_tier, importance_score, confidence_score,
       expiration_policy, tags, metadata, version
     ) VALUES ($1,$2,$3,$4::vector,COALESCE($5,0.5),COALESCE($6,0.8),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],COALESCE($19::jsonb,'{}'),COALESCE($20,1))
     RETURNING *`,
    [
      input.memory_type, input.key, input.content,
      vectorLiteral(embeddingVec),
      input.importance, input.confidence,
      input.source, input.workspace_id, input.agent_id,
      input.org_id, input.project_id, input.user_id,
      input.category, input.memory_tier,
      input.importance_score, input.confidence_score,
      input.expiration_policy,
      tagsLiteral(input.tags),
      JSON.stringify({ ...(input.metadata ?? {}), ...(input.chat_id ? { chatId: input.chat_id } : {}) }),
      input.version ?? 1,
    ],
  );
  const row = result.rows[0];
  await appendMemoryAudit(row.id, 'created');
  return row;
}

export async function getMemory(id: string) {
  const result = await query('SELECT * FROM memories WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listMemories(opts: {
  memory_type?: string;
  workspace_id?: string;
  agent_id?: string;
  org_id?: string;
  project_id?: string;
  user_id?: string;
  chat_id?: string;
  limit?: number;
}) {
  const wheres = [`superseded_by IS NULL`, `memory_type != 'archived'`];
  const params: unknown[] = [];
  let i = 1;
  if (opts.memory_type) { wheres.push(`memory_type = $${i++}`); params.push(opts.memory_type); }
  if (opts.workspace_id) { wheres.push(`workspace_id = $${i++}`); params.push(opts.workspace_id); }
  if (opts.agent_id)     { wheres.push(`agent_id = $${i++}`); params.push(opts.agent_id); }
  if (opts.org_id)       { wheres.push(`org_id = $${i++}`); params.push(opts.org_id); }
  if (opts.project_id)   { wheres.push(`project_id = $${i++}`); params.push(opts.project_id); }
  if (opts.user_id)      { wheres.push(`user_id = $${i++}`); params.push(opts.user_id); }
  if (opts.chat_id)      { wheres.push(`metadata->>'chatId' = $${i++}`); params.push(opts.chat_id); }
  params.push(Math.min(opts.limit ?? 50, 200));
  const sql = `SELECT * FROM memories WHERE ${wheres.join(' AND ')} ORDER BY recency DESC LIMIT $${i}`;
  const result = await query(sql, params);
  return result.rows;
}

export async function reviseMemory(id: string, input: Partial<MemoryInput>) {
  const current = await getMemory(id);
  if (!current) return null;
  const next = await createMemory({
    memory_type: input.memory_type ?? current.memory_type,
    key:         input.key        ?? current.key,
    content:     input.content    ?? current.content,
    embedding:   input.embedding,          // re-embed if content changed
    importance:  input.importance  ?? current.importance,
    confidence:  input.confidence  ?? current.confidence,
    source:      input.source      ?? current.source,
    workspace_id:input.workspace_id?? current.workspace_id,
    agent_id:    input.agent_id    ?? current.agent_id,
    org_id:      input.org_id      ?? current.org_id,
    project_id:  input.project_id  ?? current.project_id,
    user_id:     input.user_id     ?? current.user_id,
    chat_id:     input.chat_id     ?? current.metadata?.chatId,
    category:    input.category    ?? current.category,
    memory_tier: input.memory_tier ?? current.memory_tier,
    importance_score: input.importance_score ?? current.importance_score,
    confidence_score: input.confidence_score ?? current.confidence_score,
    expiration_policy: input.expiration_policy ?? current.expiration_policy,
    tags:        input.tags        ?? current.tags,
    metadata:    { ...(current.metadata ?? {}), ...(input.metadata ?? {}) },
    version:     (current.version ?? 1) + 1,
  });
  await query('UPDATE memories SET superseded_by = $1, updated_at = NOW() WHERE id = $2', [next.id, id]);
  await appendMemoryAudit(next.id, 'revised', undefined, { supersedes: id });
  return next;
}

// Text-in, composite-scored results out, budget enforced
export async function searchMemories(text: string, opts: SearchOptions = {}) {
  const { limit = 10, memory_type, workspace_id, agent_id, org_id, project_id, user_id, chat_id, max_tokens } = opts;
  const embedding = await embed(text);
  const vec = vectorLiteral(embedding);

  const wheres = [`superseded_by IS NULL`, `memory_type != 'archived'`, `embedding IS NOT NULL`];
  const params: unknown[] = [vec, limit * 4]; // over-fetch before budget trim
  let i = 3;
  if (memory_type)  { wheres.push(`memory_type = $${i++}`);  params.push(memory_type); }
  if (workspace_id) { wheres.push(`workspace_id = $${i++}`); params.push(workspace_id); }
  if (agent_id)     { wheres.push(`agent_id = $${i++}`);     params.push(agent_id); }
  if (chat_id || project_id || org_id || user_id) {
    wheres.push(`(
      ($${i}::text IS NOT NULL AND metadata->>'chatId' = $${i})
      OR ($${i + 1}::text IS NOT NULL AND project_id = $${i + 1})
      OR ($${i + 2}::text IS NOT NULL AND org_id = $${i + 2} AND project_id IS NULL)
      OR ($${i + 3}::text IS NOT NULL AND user_id = $${i + 3} AND project_id IS NULL AND org_id IS NULL)
      OR (
        $${i}::text IS NULL AND $${i + 1}::text IS NULL AND $${i + 2}::text IS NULL AND $${i + 3}::text IS NULL
        AND metadata->>'chatId' IS NULL AND project_id IS NULL AND org_id IS NULL AND user_id IS NULL
      )
    )`);
    params.push(chat_id ?? null, project_id ?? null, org_id ?? null, user_id ?? null);
    i += 4;
  }

  // Composite score in SQL: 0.4*sim + 0.3*recency + 0.2*importance + 0.1*confidence
  const sql = `
    SELECT *,
      CASE
        WHEN $${i}::text IS NOT NULL AND metadata->>'chatId' = $${i} THEN 1
        WHEN $${i + 1}::text IS NOT NULL AND project_id = $${i + 1} THEN 2
        WHEN $${i + 2}::text IS NOT NULL AND org_id = $${i + 2} AND project_id IS NULL THEN 3
        WHEN $${i + 3}::text IS NOT NULL AND user_id = $${i + 3} AND project_id IS NULL AND org_id IS NULL THEN 4
        ELSE 8
      END AS scope_rank,
      (0.4 * (1 - (embedding <=> $1::vector))
     + 0.3 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW() - recency)) / 2592000)
     + 0.2 * importance
     + 0.1 * confidence) AS score
    FROM memories
    WHERE ${wheres.join(' AND ')}
    ORDER BY scope_rank ASC, score DESC
    LIMIT $2
  `;
  params.push(chat_id ?? null, project_id ?? null, org_id ?? null, user_id ?? null);
  const result = await query(sql, params);

  // Apply token budget: greedily include until budget exhausted
  const budget = max_tokens ?? 2000;
  let used = 0;
  const selected = result.rows.filter(row => {
    const tokens = Math.ceil((row.content?.length ?? 0) / 4);
    if (used + tokens > budget) return false;
    used += tokens;
    return true;
  }).slice(0, limit);

  return { results: selected, token_count: used, total_found: result.rowCount };
}

export async function appendMemoryAudit(
  memoryId: string,
  action: string,
  actor?: string,
  diff?: object,
) {
  await query(
    `INSERT INTO memory_audit(memory_id, action, actor, diff) VALUES ($1,$2,$3,$4::jsonb)`,
    [memoryId, action, actor ?? null, JSON.stringify(diff ?? {})],
  );
}

export async function getMemoryAudit(memoryId: string) {
  const result = await query(
    `SELECT * FROM memory_audit WHERE memory_id = $1 ORDER BY created_at ASC`,
    [memoryId],
  );
  return result.rows;
}

// Prune memories for an agent: archive lowest-scoring memories beyond max_memory_records
export async function pruneAgentMemories(agentId: string, maxRecords: number) {
  const result = await query(
    `UPDATE memories SET memory_type = 'archived', updated_at = NOW()
     WHERE agent_id = $1 AND superseded_by IS NULL AND memory_type != 'archived'
       AND id NOT IN (
         SELECT id FROM memories
         WHERE agent_id = $1 AND superseded_by IS NULL AND memory_type != 'archived'
         ORDER BY (importance * 0.6 + confidence * 0.2
                   + GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW()-recency))/2592000) * 0.2) DESC
         LIMIT $2
       )
     RETURNING id`,
    [agentId, maxRecords],
  );
  return result.rowCount ?? 0;
}
