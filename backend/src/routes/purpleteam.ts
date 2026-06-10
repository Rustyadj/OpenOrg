import { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { query } from '../db/client.js';
import { requireSecurityToken } from './security.js';

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

const purpleTeamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireSecurityToken);

  app.get('/purple-team/findings', async () => {
    const result = await query(
      `SELECT f.*, linked.title AS linked_title, linked.remediation AS linked_remediation
       FROM security_findings f
       LEFT JOIN security_findings linked ON linked.id = f.linked_finding
       ORDER BY f.created_at DESC`,
    );
    return result.rows;
  });

  app.post('/purple-team/retest/:findingId', async (request) => {
    const queue = new Queue('purple-retests', {
      connection: redisConnection(),
    });
    const job = await queue.add('retest_finding', { findingId: (request.params as any).findingId });
    return { job_id: job.id };
  });

  app.get('/purple-team/trends', async () => {
    const result = await query(
      `SELECT date_trunc('week', created_at) AS week,
              count(*) FILTER (WHERE status IN ('open','triaged')) AS findings,
              count(*) FILTER (WHERE status IN ('remediated','retested','closed')) AS fixes
       FROM security_findings
       GROUP BY week
       ORDER BY week DESC`,
    );
    return result.rows;
  });

  app.post('/purple-team/bridge', async (request) => {
    const body = request.body as any;
    await query(`UPDATE security_alerts SET finding_id = $1, updated_at = NOW() WHERE id = $2`, [body.finding_id, body.alert_id]);
    const result = await query(`UPDATE security_findings SET linked_finding = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [body.finding_id, body.linked_finding ?? body.finding_id]);
    return result.rows[0];
  });
};

export default purpleTeamRoutes;
