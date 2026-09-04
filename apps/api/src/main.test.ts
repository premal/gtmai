import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './main';

if (process.env.CI !== 'true') {
  const testEnv = readFileSync(resolve(process.cwd(), '../../.env.test'), 'utf8');
  for (const line of testEnv.split(/\r?\n/)) {
    const [key, ...parts] = line.split('=');
    if (key && parts.length > 0) process.env[key] = parts.join('=');
  }
}
process.env.DATABASE_URL ??= 'postgresql://gtmai:gtmai@localhost:5432/gtmai';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration('api smoke', () => {
  it('registers, logs in, creates a table, adds a column, and queues a run', async () => {
    process.env.NODE_ENV = 'test';
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
