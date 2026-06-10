import request from 'supertest';
import { buildServer } from '../src/server.js';
import { query } from '../src/db/client.js';

export function vector(value: number) {
  return Array.from({ length: 1024 }, () => value);
}

export async function testApp() {
  const app = buildServer();
  await app.ready();
  return { app, request: request(app.server) };
}

export async function cleanDb() {
  const { rows } = await query<{ database: string }>('SELECT current_database() AS database');
  const database = rows[0]?.database ?? '';
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to clean non-test database "${database}"`);
  }

  await query(`DELETE FROM memory_versions`);
  await query(`DELETE FROM memory_conflicts`);
  await query(`DELETE FROM memory_reflection_logs`);
  await query(`DELETE FROM repo_memory`);
  await query(`DELETE FROM agent_profiles`);
  await query(`DELETE FROM skill_activations`);
  await query(`DELETE FROM agent_skills`);
  await query(`DELETE FROM skill_outcomes`);
  await query(`DELETE FROM skill_versions`);
  await query(`DELETE FROM audit_log`);
  await query(`DELETE FROM approvals`);
  await query(`DELETE FROM security_findings`);
  await query(`DELETE FROM security_alerts`);
  await query(`DELETE FROM security_logs`);
  await query(`DELETE FROM incidents`);
  await query(`DELETE FROM ioc_tracker`);
  await query(`DELETE FROM learning_events`);
  await query(`DELETE FROM procedural_memories`);
  await query(`DELETE FROM memories`);
  await query(`DELETE FROM agent_budgets`);
  await query(`UPDATE kill_switch SET active = false, activated_by = NULL, activated_at = NULL, reason = NULL WHERE id = 1`);
}
