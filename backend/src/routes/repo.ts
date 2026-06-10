import { FastifyPluginAsync } from 'fastify';
import { query } from '../db/client.js';
import { handleRepoWebhook, ingestRepository } from '../repo/ingestor.js';

const repoRoutes: FastifyPluginAsync = async (app) => {
  app.post('/repo/ingest', async (request) => {
    const body = request.body as any;
    const result = await ingestRepository({
      repoUrl: body.repoUrl ?? body.repo_url,
      branch: body.branch,
      org_id: body.org_id,
    });
    return envelope(result);
  });

  app.post('/repo/webhook', async (request) => {
    const result = await handleRepoWebhook(request.body as any);
    return envelope(result);
  });

  app.get('/repo/memory', async (request) => {
    const q = request.query as any;
    const result = await query(
      `SELECT * FROM repo_memory
       WHERE ($1::text IS NULL OR org_id = $1)
         AND ($2::text IS NULL OR repo_name = $2)
         AND ($3::text IS NULL OR branch = $3)
       ORDER BY updated_at DESC
       LIMIT $4`,
      [q.org_id ?? null, q.repo_name ?? null, q.branch ?? null, q.limit ? Number(q.limit) : 50],
    );
    return envelope(result.rows);
  });
};

export default repoRoutes;

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { success: true, data, meta };
}
