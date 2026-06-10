import { cleanDb, testApp, vector } from './helpers.js';

describe('scoped memory behavior', () => {
  beforeEach(cleanDb);

  test('search retrieves current project memory and blocks unrelated project leakage', async () => {
    const { app, request } = await testApp();
    await request.post('/memories').send({
      memory_type: 'project',
      key: 'proj-a.fact',
      content: 'Project Alpha uses scoped Postgres memory.',
      embedding: vector(0.1),
      project_id: 'proj-a',
      org_id: 'org-a',
      user_id: 'user-a',
    }).expect(200);
    await request.post('/memories').send({
      memory_type: 'project',
      key: 'proj-b.fact',
      content: 'Project Beta contains unrelated private launch details.',
      embedding: vector(0.1),
      project_id: 'proj-b',
      org_id: 'org-a',
      user_id: 'user-a',
    }).expect(200);

    const res = await request.post('/memories/search').send({
      q: 'project memory',
      project_id: 'proj-a',
      org_id: 'org-a',
      user_id: 'user-a',
      limit: 10,
    }).expect(200);

    const keys = res.body.results.map((row: any) => row.key);
    expect(keys).toContain('proj-a.fact');
    expect(keys).not.toContain('proj-b.fact');
    await app.close();
  });

  test('retrieval order prefers chat before project, org, and user-global memory', async () => {
    const { app, request } = await testApp();
    const rows = [
      { key: 'user.fact', content: 'User prefers concise responses.', user_id: 'user-a' },
      { key: 'org.fact', content: 'Org policy requires approval.', org_id: 'org-a' },
      { key: 'project.fact', content: 'Project Alpha roadmap is private.', project_id: 'proj-a', org_id: 'org-a' },
      { key: 'chat.fact', content: 'Current chat asked about scoped retrieval.', project_id: 'proj-a', org_id: 'org-a', metadata: { chatId: 'chat-a' } },
    ];
    for (const row of rows) {
      await request.post('/memories').send({
        memory_type: row.key.startsWith('org') ? 'org' : row.key.startsWith('project') ? 'project' : 'user',
        embedding: vector(0.1),
        user_id: 'user-a',
        ...row,
      }).expect(200);
    }

    const res = await request.post('/memories/search').send({
      q: 'scoped retrieval',
      chat_id: 'chat-a',
      project_id: 'proj-a',
      org_id: 'org-a',
      user_id: 'user-a',
      limit: 10,
    }).expect(200);

    expect(res.body.results.map((row: any) => row.key).slice(0, 4)).toEqual([
      'chat.fact',
      'project.fact',
      'org.fact',
      'user.fact',
    ]);
    await app.close();
  });

  test('low-importance content remains working memory instead of permanent storage', async () => {
    const { app, request } = await testApp();
    const res = await request.post('/memory/create').send({
      content: 'thanks',
      user_id: 'user-a',
    }).expect(200);

    expect(res.body.data.status).toBe('working');
    expect(res.body.data.gate.permanent).toBe(false);
    expect(res.body.data.gate.importance_score).toBeLessThan(5);
    await app.close();
  });
});
