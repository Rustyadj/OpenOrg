import { cleanDb, testApp, vector } from './helpers.js';

describe('memory CRUD and versioning', () => {
  beforeEach(cleanDb);

  test('stores, retrieves, and revisions supersede old memory', async () => {
    const { app, request } = await testApp();
    const created = await request.post('/memories').send({
      memory_type: 'agent',
      key: 'memory.version',
      content: 'initial content',
      embedding: vector(0.1),
    }).expect(200);

    await request.get(`/memories/${created.body.id}`).expect(200).expect((res) => {
      expect(res.body.content).toBe('initial content');
    });

    const revised = await request.patch(`/memories/${created.body.id}`).send({ content: 'revised content' }).expect(200);
    await request.get(`/memories/${created.body.id}`).expect(200).expect((res) => {
      expect(res.body.superseded_by).toBe(revised.body.id);
    });
    await app.close();
  });
});
