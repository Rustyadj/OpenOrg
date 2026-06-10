import { FastifyPluginAsync } from 'fastify';
import {
  createMemory, getMemory, listMemories, reviseMemory,
  searchMemories, getMemoryAudit, pruneAgentMemories,
} from '../services/memory.js';
import { embed } from '../services/embed.js';

const memoryRoutes: FastifyPluginAsync = async (app) => {
  // List memories with optional filters
  app.get('/memories', async (request) => {
    const q = request.query as any;
    return listMemories({
      memory_type:  q.memory_type,
      workspace_id: q.workspace_id,
      agent_id:     q.agent_id,
      org_id:       q.org_id,
      project_id:   q.project_id,
      user_id:      q.user_id,
      chat_id:      q.chat_id,
      limit:        q.limit ? Number(q.limit) : 50,
    });
  });

  // Create — embeds content server-side via Voyage
  app.post('/memories', async (request, reply) => {
    const body = request.body as any;
    if (!body?.memory_type || !body?.key || !body?.content) {
      return reply.code(400).send({ error: 'memory_type, key and content are required' });
    }
    return createMemory(body);
  });

  app.get('/memories/:id', async (request, reply) => {
    const memory = await getMemory((request.params as any).id);
    if (!memory) return reply.code(404).send({ error: 'not_found' });
    return memory;
  });

  app.patch('/memories/:id', async (request, reply) => {
    const memory = await reviseMemory((request.params as any).id, request.body as any);
    if (!memory) return reply.code(404).send({ error: 'not_found' });
    return memory;
  });

  app.delete('/memories/:id', async (request) => {
    const { id } = request.params as any;
    const { query } = await import('../db/client.js');
    await query(`UPDATE memories SET memory_type = 'archived', updated_at = NOW() WHERE id = $1`, [id]);
    return { archived: true };
  });

  // Text-in semantic search — composite scored, budget enforced
  app.post('/memories/search', async (request) => {
    const body = request.body as any;
    if (!body?.q) return { results: [], token_count: 0, total_found: 0 };
    return searchMemories(body.q, {
      limit:        body.limit       ? Number(body.limit) : 10,
      memory_type:  body.memory_type,
      workspace_id: body.workspace_id,
      agent_id:     body.agent_id,
      org_id:       body.org_id,
      project_id:   body.project_id,
      user_id:      body.user_id,
      chat_id:      body.chat_id,
      max_tokens:   body.max_tokens != null ? Number(body.max_tokens) : 2000,
    });
  });

  // Audit history for a specific memory
  app.get('/memories/audit/:id', async (request, reply) => {
    const audit = await getMemoryAudit((request.params as any).id);
    if (!audit.length) return reply.code(404).send({ error: 'not_found' });
    return audit;
  });

  app.get('/memories/:id/audit', async (request, reply) => {
    const audit = await getMemoryAudit((request.params as any).id);
    if (!audit.length) return reply.code(404).send({ error: 'not_found' });
    return audit;
  });

  app.get('/memory/health', async () => {
    const { query } = await import('../db/client.js');
    const [dbNow, vectorExt, memoryTables, lastWrite, lastRetrieval, scopes] = await Promise.all([
      query('SELECT NOW() AS now').then(r => r.rows[0]),
      query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`).then(r => r.rows[0] ?? null),
      query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('memories','memory_audit','repo_memory') ORDER BY table_name`).then(r => r.rows.map(x => x.table_name)),
      query(`SELECT updated_at FROM memories ORDER BY updated_at DESC LIMIT 1`).then(r => r.rows[0]?.updated_at ?? null),
      query(`SELECT last_retrieved_at FROM memories WHERE last_retrieved_at IS NOT NULL ORDER BY last_retrieved_at DESC LIMIT 1`).then(r => r.rows[0]?.last_retrieved_at ?? null),
      query(`
        SELECT DISTINCT scope FROM (
          SELECT 'chat' AS scope FROM memories WHERE metadata->>'chatId' IS NOT NULL
          UNION SELECT 'project' FROM memories WHERE project_id IS NOT NULL
          UNION SELECT 'org' FROM memories WHERE org_id IS NOT NULL
          UNION SELECT 'user' FROM memories WHERE user_id IS NOT NULL
          UNION SELECT 'agent' FROM memories WHERE agent_id IS NOT NULL
        ) s ORDER BY scope
      `).then(r => r.rows.map(x => x.scope)),
    ]);
    let embeddingsWorking = false;
    try {
      const probe = await embed('memory health check');
      embeddingsWorking = Array.isArray(probe) && probe.length === 1024;
    } catch {
      embeddingsWorking = false;
    }
    return {
      database_connected: Boolean(dbNow),
      vector_extension_available: Boolean(vectorExt),
      memory_plugin_loaded: true,
      embeddings_working: embeddingsWorking,
      memory_tables: memoryTables,
      last_memory_write: lastWrite,
      last_memory_retrieval: lastRetrieval,
      active_scopes: scopes,
    };
  });

  // Prune agent memories to stay within max_records budget
  app.post('/memories/prune', async (request) => {
    const { agent_id, max_records = 500 } = request.body as any;
    if (!agent_id) return { pruned: 0 };
    const pruned = await pruneAgentMemories(agent_id, Number(max_records));
    return { pruned };
  });
};

export default memoryRoutes;
