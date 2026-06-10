import { cleanDb, testApp } from './helpers.js';

describe('governance', () => {
  beforeEach(cleanDb);

  test('kill switch sets all agents to killed status', async () => {
    const { app, request } = await testApp();
    await request.post('/resources/agents').send({
      agentId: 'agent-a',
      token_budget: 100,
      cpu_budget_pct: 50,
      mem_budget_mb: 256,
      priority: 'normal',
    }).expect(200);

    await request.post('/governance/kill-switch/activate').send({ activated_by: 'test', reason: 'test' }).expect(200);
    await request.get('/resources/agents/agent-a').expect(200).expect((res) => {
      expect(res.body.status).toBe('killed');
    });
    await app.close();
  });
});
