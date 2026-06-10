import { jest } from '@jest/globals';
import { cleanDb, testApp } from './helpers.js';
import { query } from '../src/db/client.js';
import { invalidateAgentSkillCache } from '../src/services/actuator.js';

jest.mock('../src/services/openai.js', () => ({
  getOpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{ message: { content: JSON.stringify({ skills: [] }) } }],
        })),
      },
    },
  })),
}));

async function insertSkill(
  skillName: string,
  opts: {
    version?: number;
    approved?: boolean;
    rolled_back?: boolean;
    success_rate?: number;
    definition?: Record<string, unknown>;
  } = {},
) {
  const result = await query(
    `INSERT INTO skill_versions(skill_name, version, definition, success_rate, changelog, approved, rolled_back)
     VALUES ($1, $2, $3::jsonb, $4, 'test', $5, $6)
     RETURNING *`,
    [
      skillName,
      opts.version ?? 1,
      JSON.stringify(opts.definition ?? { instructions: `Use ${skillName} carefully.` }),
      opts.success_rate ?? 0.9,
      opts.approved ?? true,
      opts.rolled_back ?? false,
    ],
  );
  return result.rows[0];
}

async function assign(agentId: string, skillName: string, priority = 0, version = 1) {
  await query(
    `INSERT INTO agent_skills(agent_id, skill_name, version, enabled, priority)
     VALUES ($1, $2, $3, TRUE, $4)
     ON CONFLICT (agent_id, skill_name) DO UPDATE SET enabled = TRUE, version = EXCLUDED.version, priority = EXCLUDED.priority`,
    [agentId, skillName, version, priority],
  );
}

describe('skill actuator', () => {
  beforeEach(async () => {
    invalidateAgentSkillCache('agent-a');
    await cleanDb();
  });

  test('GET /actuator/:agentId/context returns [SKILLS] context_block format', async () => {
    const { app, request } = await testApp();
    await insertSkill('summarize', { definition: { instructions: 'Summarize facts in one concise paragraph.' } });
    await assign('agent-a', 'summarize', 10);

    const result = await request.get('/actuator/agent-a/context').expect(200);
    expect(result.body.context_block).toContain('[SKILLS: agent-a]');
    expect(result.body.context_block).toContain('summarize@v1 (90%): Summarize facts in one concise paragraph.');
    expect(result.body.context_block).toContain('[/SKILLS]');
    await app.close();
  });

  test('skills with approved=FALSE are excluded from context', async () => {
    const { app, request } = await testApp();
    await insertSkill('drafting', { approved: false, definition: { instructions: 'Draft copy.' } });
    await assign('agent-a', 'drafting');

    const result = await request.get('/actuator/agent-a/context').expect(200);
    expect(result.body.skills).toHaveLength(0);
    expect(result.body.context_block).not.toContain('drafting@v1');
    await app.close();
  });

  test('skills with rolled_back=TRUE are excluded from context', async () => {
    const { app, request } = await testApp();
    await insertSkill('planner', { rolled_back: true, definition: { instructions: 'Plan steps.' } });
    await assign('agent-a', 'planner');

    const result = await request.get('/actuator/agent-a/context').expect(200);
    expect(result.body.skills).toHaveLength(0);
    expect(result.body.context_block).not.toContain('planner@v1');
    await app.close();
  });

  test('max_tokens budget is respected', async () => {
    const { app, request } = await testApp();
    await insertSkill('small', { definition: { instructions: 'Do it.' } });
    await insertSkill('large', { definition: { instructions: 'This instruction is intentionally too long to fit inside a tiny token budget for the active skill context.' } });
    await assign('agent-a', 'large', 20);
    await assign('agent-a', 'small', 10);

    const result = await request.get('/actuator/agent-a/context?max_tokens=4').expect(200);
    expect(result.body.total_tokens).toBeLessThanOrEqual(4);
    expect(result.body.context_block).toContain('small@v1');
    expect(result.body.context_block).not.toContain('large@v1');
    await app.close();
  });

  test('context block is served from cache on second call within 60 seconds', async () => {
    const { app, request } = await testApp();
    await insertSkill('cacheable', { definition: { instructions: 'Reuse cached instruction.' } });
    await assign('agent-a', 'cacheable');

    await request.get('/actuator/agent-a/context').expect(200);
    await request.get('/actuator/agent-a/context').expect(200);

    const activations = await query(`SELECT count(*)::int AS count FROM skill_activations WHERE agent_id = 'agent-a'`);
    expect(activations.rows[0].count).toBe(1);
    await app.close();
  });

  test('POST /actuator/:agentId/skills rejects unrecognized skill names', async () => {
    const { app, request } = await testApp();
    await request.post('/actuator/agent-a/skills').send({ skill_name: 'missing-skill' }).expect(404);
    await app.close();
  });

  test('POST /actuator/:agentId/outcome with repeated failures triggers proposeSkillUpdate', async () => {
    const { app, request } = await testApp();
    await insertSkill('regressing', { definition: { instructions: 'Original instruction.' }, success_rate: 1 });
    await assign('agent-a', 'regressing');
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO skill_outcomes(skill_name, version, agent_id, success, feedback, created_at)
         VALUES ('regressing', 1, 'agent-a', TRUE, 'prior success', NOW() - INTERVAL '8 days')`,
      );
    }

    for (let i = 0; i < 10; i++) {
      await request.post('/actuator/agent-a/outcome').send({ skill_name: 'regressing', success: false, feedback: `failure ${i}` }).expect(200);
    }

    const proposed = await query(
      `SELECT * FROM skill_versions WHERE skill_name = 'regressing' AND version = 2 AND approved = FALSE`,
    );
    expect(proposed.rows).toHaveLength(1);
    expect(proposed.rows[0].changelog).toContain('Auto-proposed: regression detected');
    await app.close();
  });

  test('GET /actuator/:agentId/activations returns log entries after context call', async () => {
    const { app, request } = await testApp();
    await insertSkill('activate-me', { definition: { instructions: 'Activate this skill.' } });
    await assign('agent-a', 'activate-me');

    await request.get('/actuator/agent-a/context?task_context=test').expect(200);
    const result = await request.get('/actuator/agent-a/activations').expect(200);
    expect(result.body[0]).toEqual(expect.objectContaining({
      agent_id: 'agent-a',
      skill_name: 'activate-me',
      version: 1,
      context: 'test',
    }));
    await app.close();
  });
});
