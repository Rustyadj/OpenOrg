import { cleanDb, testApp } from './helpers.js';

describe('red team findings', () => {
  const originalSecurity = process.env.SECURITY_TOKEN;

  beforeEach(async () => {
    process.env.SECURITY_TOKEN = 'security-test';
    await cleanDb();
  });

  afterAll(() => {
    process.env.SECURITY_TOKEN = originalSecurity;
  });

  test('levels 4-5 return 403 without approval record', async () => {
    const { app, request } = await testApp();
    await request.post('/red-team/findings')
      .set('X-Security-Token', 'security-test')
      .send({ title: 'critical finding', description: 'needs approval', severity: 'critical', level: 4 })
      .expect(403);
    await app.close();
  });
});
