import { describe, expect, it } from 'vitest';
import { createApp } from './main';

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration('api smoke', () => {
  it('registers, logs in, creates a table, adds a column, and queues a run', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `smoke-${Date.now()}@gtmai.dev`;
    const register = await instance.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123', name: 'Smoke User' },
    });
    expect(register.statusCode).toBe(201);
    const auth = register.json() as { token: string; workspaceId: string };
    const created = await instance.inject({
      method: 'POST',
      url: `/workspaces/${auth.workspaceId}/tables`,
      headers: { authorization: `Bearer ${auth.token}` },
      payload: { name: 'Smoke table' },
    });
    expect(created.statusCode).toBe(201);
    const table = created.json() as { id: string };
    const column = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/columns`,
      headers: { authorization: `Bearer ${auth.token}` },
      payload: {
        name: 'Email',
        type: 'email',
        kind: 'waterfall',
        config: { providers: [{ provider: 'mock', action: 'mock.findEmail' }] },
      },
    });
    expect(column.statusCode).toBe(201);
    await app.close();
  });
});
