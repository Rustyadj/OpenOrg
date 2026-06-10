import pg, { QueryResultRow } from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://openclaw:openclaw@localhost:5435/openclaw',
});

export async function query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}

export async function appendAudit(eventType: string, resourceType: string, resourceId: string | null, actor: string | null, payload: object = {}) {
  await query(
    `INSERT INTO audit_log(event_type, resource_type, resource_id, actor, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [eventType, resourceType, resourceId, actor, JSON.stringify(payload)],
  );
}

export async function closeDb() {
  await pool.end();
}
