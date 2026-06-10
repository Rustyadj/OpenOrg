import { FastifyPluginAsync } from 'fastify';
import { appendAudit, query } from '../db/client.js';

const governanceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/governance/approvals', async (request) => {
    const body = request.body as any;
    const result = await query(
      `INSERT INTO approvals(resource_type, resource_id, action, requested_by, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [body.resource_type, body.resource_id, body.action, body.requested_by, body.reason ?? null],
    );
    await appendAudit('approval_requested', 'approvals', result.rows[0].id, body.requested_by, body);
    return result.rows[0];
  });

  app.get('/governance/approvals', async (request) => {
    const status = (request.query as any).status;
    const result = status
      ? await query('SELECT * FROM approvals WHERE status = $1 ORDER BY created_at DESC', [status])
      : await query('SELECT * FROM approvals ORDER BY created_at DESC');
    return result.rows;
  });

  app.post('/governance/approvals/:id/review', async (request, reply) => {
    const body = request.body as any;
    const result = await query(
      `UPDATE approvals
       SET status = $2, reviewed_by = $3, reviewed_at = NOW(), reason = COALESCE($4, reason)
       WHERE id = $1
       RETURNING *`,
      [(request.params as any).id, body.decision, body.reviewed_by, body.reason ?? null],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await appendAudit('approval_reviewed', 'approvals', result.rows[0].id, body.reviewed_by, body);
    return result.rows[0];
  });

  app.post('/governance/kill-switch/activate', async (request) => {
    const body = request.body as any;
    const result = await query(
      `UPDATE kill_switch
       SET active = true, activated_by = $1, activated_at = NOW(), reason = $2
       WHERE id = 1
       RETURNING *`,
      [body.activated_by, body.reason ?? null],
    );
    await query(`UPDATE agent_budgets SET status = 'killed', updated_at = NOW()`);
    await appendAudit('kill_switch_activated', 'kill_switch', '1', body.activated_by, body);
    return result.rows[0];
  });

  app.post('/governance/kill-switch/deactivate', async (request, reply) => {
    const body = request.body as any;
    const approval = await query(
      `SELECT id FROM approvals
       WHERE resource_type = 'kill_switch' AND resource_id = '1' AND action = 'deactivate' AND status = 'approved'
       ORDER BY reviewed_at DESC LIMIT 1`,
    );
    if (!approval.rows.length) return reply.code(403).send({ error: 'approval_required' });
    const result = await query(
      `UPDATE kill_switch SET active = false, activated_by = NULL, activated_at = NULL, reason = $1 WHERE id = 1 RETURNING *`,
      [body.reason ?? null],
    );
    await appendAudit('kill_switch_deactivated', 'kill_switch', '1', body.reviewed_by ?? body.actor ?? null, body);
    return result.rows[0];
  });

  app.get('/governance/kill-switch', async () => (await query('SELECT * FROM kill_switch WHERE id = 1')).rows[0]);

  app.get('/governance/audit', async (request) => {
    const q = request.query as any;
    const clauses = [];
    const params: unknown[] = [];
    if (q.resource_type) {
      params.push(q.resource_type);
      clauses.push(`resource_type = $${params.length}`);
    }
    if (q.actor) {
      params.push(q.actor);
      clauses.push(`actor = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      clauses.push(`created_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      clauses.push(`created_at <= $${params.length}`);
    }
    const sql = `SELECT * FROM audit_log ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`;
    return (await query(sql, params)).rows;
  });

  app.get('/governance/audit/export', async (_request, reply) => {
    const rows = (await query('SELECT * FROM audit_log ORDER BY created_at')).rows;
    reply.header('content-type', 'application/x-ndjson');
    return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  });
};

export default governanceRoutes;
