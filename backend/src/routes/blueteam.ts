import { FastifyPluginAsync } from 'fastify';
import { query } from '../db/client.js';
import { requireSecurityToken } from './security.js';

const blueTeamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireSecurityToken);

  app.post('/blue-team/logs/ingest', async (request) => {
    const logs = Array.isArray(request.body) ? request.body as any[] : (request.body as any).logs ?? [];
    const inserted = [];
    for (const log of logs) {
      const result = await query(
        `INSERT INTO security_logs(source, level, message, payload) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
        [log.source ?? null, log.level ?? 'info', log.message ?? JSON.stringify(log), JSON.stringify(log.payload ?? log)],
      );
      inserted.push(result.rows[0]);
    }
    return { inserted };
  });

  app.get('/blue-team/alerts', async (request) => {
    const severity = (request.query as any).severity;
    const result = severity
      ? await query('SELECT * FROM security_alerts WHERE severity = $1 ORDER BY created_at DESC', [severity])
      : await query('SELECT * FROM security_alerts ORDER BY created_at DESC');
    return result.rows;
  });

  app.post('/blue-team/alerts', async (request) => {
    const body = request.body as any;
    const result = await query(
      `INSERT INTO security_alerts(title, description, severity, status, source) VALUES ($1, $2, $3, COALESCE($4, 'open'), $5) RETURNING *`,
      [body.title, body.description ?? null, body.severity ?? 'medium', body.status ?? 'open', body.source ?? null],
    );
    return result.rows[0];
  });

  app.patch('/blue-team/alerts/:id/triage', async (request, reply) => {
    const body = request.body as any;
    const result = await query(
      `UPDATE security_alerts SET severity = COALESCE($2, severity), status = COALESCE($3, status), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [(request.params as any).id, body.severity ?? null, body.status ?? null],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return result.rows[0];
  });

  app.post('/blue-team/ioc', async (request) => {
    const body = request.body as any;
    const result = await query(
      `INSERT INTO ioc_tracker(ioc_type, value, severity, description, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.ioc_type, body.value, body.severity ?? 'medium', body.description ?? null, body.expires_at ?? null],
    );
    return result.rows[0];
  });

  app.get('/blue-team/ioc', async () => (await query(`SELECT * FROM ioc_tracker WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY created_at DESC`)).rows);

  app.post('/blue-team/incidents', async (request) => {
    const body = request.body as any;
    const result = await query(
      `INSERT INTO incidents(title, description, severity, status, assigned_to, timeline)
       VALUES ($1, $2, $3, COALESCE($4, 'open'), $5, COALESCE($6::jsonb, '[]')) RETURNING *`,
      [body.title, body.description ?? null, body.severity ?? 'medium', body.status ?? 'open', body.assigned_to ?? null, JSON.stringify(body.timeline ?? [])],
    );
    return result.rows[0];
  });

  app.get('/blue-team/incidents', async () => (await query('SELECT * FROM incidents ORDER BY created_at DESC')).rows);

  app.patch('/blue-team/incidents/:id', async (request, reply) => {
    const body = request.body as any;
    const result = await query(
      `UPDATE incidents
       SET status = COALESCE($2, status),
           timeline = timeline || COALESCE($3, '[]')::jsonb,
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [(request.params as any).id, body.status ?? null, JSON.stringify(body.timeline_append ? [body.timeline_append] : [])],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return result.rows[0];
  });
};

export default blueTeamRoutes;
