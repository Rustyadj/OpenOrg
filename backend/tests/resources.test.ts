import { cleanDb, testApp } from './helpers.js';
import { query } from '../src/db/client.js';

describe('resource manager', () => {
  beforeEach(cleanDb);

  test('runaway detection fires when tokens exceed 3x budget', async () => {
    const { app, request } = await testApp();
    await request.post('/resources/agents').send({
      agentId: 'agent-runaway',
      token_budget: 100,
      cpu_budget_pct: 50,
      mem_budget_mb: 256,
      priority: 'normal',
    }).expect(200);

    const result = await request.post('/resources/agents/agent-runaway/tokens').send({ tokens: 301 }).expect(200);
    expect(result.body.status).toBe('killed');
    await app.close();
  });

  test('heartbeat is a no-op when disabled', async () => {
    const { app, request } = await testApp();
    await request.post('/resources/agents').send({
      agentId: 'agent-heartbeat',
      token_budget: 100,
      cpu_budget_pct: 50,
      mem_budget_mb: 256,
      priority: 'normal',
    }).expect(200);

    const before = await query<{ last_heartbeat: string; updated_at: string }>(
      `SELECT last_heartbeat, updated_at
       FROM agent_budgets
       WHERE agent_id = $1`,
      ['agent-heartbeat'],
    );
    const beforeRow = before.rows[0] as any;
    const beforeHeartbeat = beforeRow.last_heartbeat instanceof Date
      ? beforeRow.last_heartbeat.toISOString()
      : beforeRow.last_heartbeat;
    const beforeUpdatedAt = beforeRow.updated_at instanceof Date
      ? beforeRow.updated_at.toISOString()
      : beforeRow.updated_at;

    const result = await request.post('/resources/agents/agent-heartbeat/heartbeat').expect(200);
    expect(result.body.last_heartbeat).toBe(beforeHeartbeat);
    expect(result.body.updated_at).toBe(beforeUpdatedAt);
    await app.close();
  });

  test('sweep does not kill stale agents when heartbeat is disabled', async () => {
    const { app, request } = await testApp();
    await request.post('/resources/agents').send({
      agentId: 'agent-stale',
      token_budget: 100,
      cpu_budget_pct: 50,
      mem_budget_mb: 256,
      priority: 'normal',
    }).expect(200);

    await query(
      `UPDATE agent_budgets
       SET last_heartbeat = NOW() - INTERVAL '10 minutes'
       WHERE agent_id = $1`,
      ['agent-stale'],
    );

    await request.post('/resources/sweep').send({}).expect(200);
    await request.get('/resources/agents/agent-stale').expect(200).expect((res) => {
      expect(res.body.status).toBe('active');
    });
    await app.close();
  });
});
