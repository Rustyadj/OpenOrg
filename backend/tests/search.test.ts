import { cleanDb, testApp, vector } from './helpers.js';

describe('semantic search', () => {
  beforeEach(cleanDb);

  test('search returns results envelope with score, token_count, and total_found', async () => {
    const { app, request } = await testApp();

    // Store two memories. The Voyage mock returns the same vector for all embeds,
    // so both will be equally similar. What we verify is the response shape and
    // that composite scoring fields (score, token_count) are present.
    await request.post('/memories')
      .send({ memory_type: 'project', key: 'alpha', content: 'alpha content for testing search', embedding: vector(0.1) })
      .expect(200);
    await request.post('/memories')
      .send({ memory_type: 'project', key: 'beta', content: 'beta content for testing search', embedding: vector(0.1) })
      .expect(200);

    const result = await request.post('/memories/search')
      .send({ q: 'test query text', limit: 5, max_tokens: 2000 })
      .expect(200);

    // Response must have the envelope shape (not a bare array)
    expect(result.body).toHaveProperty('results');
    expect(result.body).toHaveProperty('token_count');
    expect(result.body).toHaveProperty('total_found');
    expect(Array.isArray(result.body.results)).toBe(true);

    // Every result must carry a composite score
    for (const mem of result.body.results) {
      expect(typeof mem.score).toBe('number');
      expect(mem.score).toBeGreaterThanOrEqual(0);
    }

    // Results must be ordered score DESC
    const scores: number[] = result.body.results.map((m: any) => Number(m.score));
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }

    // Token count must be within the requested budget
    expect(result.body.token_count).toBeLessThanOrEqual(2000);

    await app.close();
  });

  test('search with max_tokens=0 returns empty results', async () => {
    const { app, request } = await testApp();
    await request.post('/memories')
      .send({ memory_type: 'user', key: 'any', content: 'some content here' })
      .expect(200);

    const result = await request.post('/memories/search')
      .send({ q: 'any query', max_tokens: 0 })
      .expect(200);

    expect(result.body.results).toHaveLength(0);
    expect(result.body.token_count).toBe(0);
    await app.close();
  });

  test('search with no q returns empty envelope without error', async () => {
    const { app, request } = await testApp();
    const result = await request.post('/memories/search').send({}).expect(200);
    expect(result.body.results).toHaveLength(0);
    await app.close();
  });
});
