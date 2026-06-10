import { FastifyPluginAsync } from 'fastify';
import { query } from '../db/client.js';
import { getAgentProfile } from '../memory/agent-profile.js';
import { buildContextPack } from '../memory/context-pack.js';
import { reprocessMemory, runWriteGate, createMemoryThroughGate } from '../memory/write-gate.js';
import { embed } from '../services/embed.js';

const memoryOsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/memory/write-gate', async (request) => {
    const gate = await runWriteGate(request.body as any);
    return envelope(gate, { tokensUsed: estimateTokens(gate.normalized_content) });
  });

  app.post('/memory/create', async (request) => {
    const result = await createMemoryThroughGate(request.body as any);
    return envelope(result, { tokensUsed: estimateTokens(result.gate.normalized_content) });
  });

  app.get('/memory/retrieve', async (request) => {
    const q = request.query as any;
    const data = await retrieveMemoryOs({
      query: String(q.query ?? q.q ?? ''),
      project_id: q.project_id,
      org_id: q.org_id,
      user_id: q.user_id,
      limit: q.limit ? Number(q.limit) : 10,
    });
    return envelope(data.results, {
      retrievalPath: data.retrievalPath,
      scoreBreakdown: data.results[0]?.scoreBreakdown,
      tokensUsed: data.tokensUsed,
    });
  });

  app.get('/memory/inspect/:id', async (request, reply) => {
    const { id } = request.params as any;
    const result = await query(`SELECT * FROM memories WHERE id = $1`, [id]);
    const memory = result.rows[0];
    if (!memory) return reply.code(404).send(envelope(null));
    const edges = await query(
      `SELECT * FROM memory_graph_edges WHERE from_id = $1 OR to_id = $1 ORDER BY updated_at DESC`,
      [id],
    ).catch(() => ({ rows: [] }));
    return envelope({ memory, graphEdges: edges.rows, retrievalScore: null });
  });

  app.post('/memory/resolve-conflict', async (request) => {
    const body = request.body as any;
    const result = await query(
      `UPDATE memory_conflicts
       SET resolution_status = $2,
           chosen_memory_id = $3,
           explanation = $4,
           resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [body.id, body.resolution_status ?? 'resolved', body.chosen_memory_id ?? null, body.explanation ?? null],
    );
    return envelope(result.rows[0] ?? null);
  });

  app.get('/memory/conflicts', async () => {
    const result = await query(
      `SELECT * FROM memory_conflicts
       WHERE resolution_status = 'unresolved' OR resolved_at IS NULL
       ORDER BY created_at DESC`,
    );
    return envelope(result.rows);
  });

  app.get('/memory/reflections', async () => {
    const result = await query(`SELECT * FROM memory_reflection_logs ORDER BY created_at DESC LIMIT 200`);
    return envelope(result.rows);
  });

  app.post('/memory/reprocess', async (request, reply) => {
    const body = request.body as any;
    const result = await reprocessMemory(body.id ?? body.memory_id);
    if (!result) return reply.code(404).send(envelope(null));
    return envelope(result);
  });

  app.post('/memory/context-pack', async (request) => {
    const pack = await buildContextPack(request.body as any);
    return envelope(pack, { tokensUsed: pack.totalTokens });
  });

  app.get('/agent-profile/:agentId', async (request) => {
    const { agentId } = request.params as any;
    return envelope(await getAgentProfile(agentId));
  });
};

export default memoryOsRoutes;

interface RetrieveInput {
  query: string;
  project_id?: string;
  org_id?: string;
  user_id?: string;
  limit: number;
}

async function retrieveMemoryOs(input: RetrieveInput) {
  const candidates = new Map<string, any>();
  const retrievalPath: string[] = [];

  await addRows(candidates, 'Decision Memory', `
    SELECT *, 1.0 AS relevance FROM memories
    WHERE memory_type != 'archived' AND superseded_by IS NULL AND category = 'decision'
      AND ($1::text IS NULL OR org_id = $1)
      AND ($2::text IS NULL OR project_id = $2)
    ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
    LIMIT 20`, [input.org_id ?? null, input.project_id ?? null], retrievalPath);

  await addRows(candidates, 'Active Project Memory', `
    SELECT *, 0.95 AS relevance FROM memories
    WHERE memory_type != 'archived' AND superseded_by IS NULL
      AND ($1::text IS NULL OR project_id = $1)
      AND category IN ('project','workflow','semantic')
    ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
    LIMIT 20`, [input.project_id ?? null], retrievalPath);

  await addRows(candidates, 'Organization Memory', `
    SELECT *, 0.90 AS relevance FROM memories
    WHERE memory_type != 'archived' AND superseded_by IS NULL
      AND ($1::text IS NULL OR org_id = $1)
      AND category IN ('org','governance')
    ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
    LIMIT 20`, [input.org_id ?? null], retrievalPath);

  if (/\b(my|me|i |prefer|identity|profile)\b/i.test(input.query)) {
    await addRows(candidates, 'User Identity Memory', `
      SELECT *, 0.88 AS relevance FROM memories
      WHERE memory_type != 'archived' AND superseded_by IS NULL
        AND ($1::text IS NULL OR user_id = $1)
        AND category IN ('identity','preference')
      ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
      LIMIT 12`, [input.user_id ?? null], retrievalPath);
  }

  await addGraphLinked(candidates, retrievalPath);

  if (candidates.size < input.limit && input.query) {
    const vector = await embed(input.query);
    await addRows(candidates, 'Vector Search', `
      SELECT *, 1 - (embedding <=> $1::vector) AS relevance
      FROM memories
      WHERE memory_type != 'archived'
        AND superseded_by IS NULL
        AND embedding IS NOT NULL
      ORDER BY relevance DESC
      LIMIT $2`, [vectorLiteral(vector), input.limit * 2], retrievalPath);
  }

  const results = [...candidates.values()]
    .map((row) => {
      const relevance = Number(row.relevance ?? 0.75);
      const confidence = Number(row.confidence_score ?? row.confidence ?? 0.8);
      const importance = Number(row.importance_score ?? Math.round(Number(row.importance ?? 0.5) * 10));
      const finalScore = relevance * confidence * (importance / 10);
      return {
        ...row,
        retrievalScore: finalScore,
        retrievalPath: row.retrievalPath,
        scoreBreakdown: { relevance, confidence, importanceFactor: importance / 10, agentCategoryBoost: 1, finalScore },
      };
    })
    .sort((a, b) => {
      if (a.category === 'decision' && b.category !== 'decision') return -1;
      if (b.category === 'decision' && a.category !== 'decision') return 1;
      return b.retrievalScore - a.retrievalScore;
    })
    .slice(0, input.limit);

  if (results.length) {
    await query(`UPDATE memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = NOW() WHERE id = ANY($1::uuid[])`, [results.map((row) => row.id)]);
  }

  return { results, retrievalPath, tokensUsed: results.reduce((sum, row) => sum + estimateTokens(row.content ?? ''), 0) };
}

async function addRows(candidates: Map<string, any>, path: string, sql: string, params: unknown[], retrievalPath: string[]) {
  const result = await query(sql, params);
  if (result.rows.length) retrievalPath.push(path);
  for (const row of result.rows) {
    const existing = candidates.get(row.id);
    if (!existing || Number(row.relevance ?? 0) > Number(existing.relevance ?? 0)) {
      candidates.set(row.id, { ...row, retrievalPath: [path] });
    }
  }
}

async function addGraphLinked(candidates: Map<string, any>, retrievalPath: string[]) {
  const ids = [...candidates.keys()];
  if (!ids.length) return;
  const result = await query(
    `SELECT DISTINCT m.*, 0.80 AS relevance
     FROM memory_graph_edges e
     JOIN memories m ON m.id = CASE WHEN e.from_id = ANY($1::uuid[]) THEN e.to_id ELSE e.from_id END
     WHERE (e.from_id = ANY($1::uuid[]) OR e.to_id = ANY($1::uuid[]))
       AND m.memory_type != 'archived'
       AND m.superseded_by IS NULL
     LIMIT 20`,
    [ids],
  ).catch(() => ({ rows: [] }));
  if (result.rows.length) retrievalPath.push('Graph-linked Memory');
  for (const row of result.rows) if (!candidates.has(row.id)) candidates.set(row.id, { ...row, retrievalPath: ['Graph-linked Memory'] });
}

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { success: true, data, meta };
}

function estimateTokens(content: string): number {
  return Math.ceil(String(content).length / 4);
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
