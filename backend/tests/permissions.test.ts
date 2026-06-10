import { testApp } from './helpers.js';

describe('permissions', () => {
  const originalAuth = process.env.AUTH_TOKEN;
  const originalSecurity = process.env.SECURITY_TOKEN;

  beforeEach(async () => {
    process.env.AUTH_TOKEN = 'auth-test';
    process.env.SECURITY_TOKEN = 'security-test';
  });

  afterAll(() => {
    process.env.AUTH_TOKEN = originalAuth;
    process.env.SECURITY_TOKEN = originalSecurity;
  });

  test('unauthenticated requests return 401', async () => {
    const { app, request } = await testApp();
    await request.get('/resources/agents').expect(401);
    await app.close();
  });

  test('security endpoints without X-Security-Token return 403', async () => {
    const { app, request } = await testApp();
    await request.get('/red-team/findings').set('Authorization', 'Bearer auth-test').expect(403);
    await app.close();
  });
});
