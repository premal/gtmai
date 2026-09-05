import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../main';

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

describe('people fanout', () => {
  it('fans out mock people and carries source values', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `fanout-${Date.now()}@gtmai.dev`;
    const register = await instance.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123', name: 'Fanout User' },
    });
    const auth = register.json() as { token: string; workspaceId: string };
    const headers = { authorization: `Bearer ${auth.token}` };
    const connection = await instance.inject({
      method: 'POST',
      url: '/connections',
      headers,
      payload: { provider: 'mock', name: 'Mock', credentials: {} },
    });
    expect(connection.statusCode).toBe(201);
    const connections = await instance.inject({
      method: 'GET',
      url: '/connections',
      headers,
    });
    expect(connections.statusCode).toBe(200);
    expect(connections.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'mock' })]),
    );
    const tableResponse = await instance.inject({
      method: 'POST',
      url: `/workspaces/${auth.workspaceId}/tables`,
      headers,
      payload: { name: 'Companies' },
    });
    const table = tableResponse.json() as { id: string };
    for (const name of ['Company', 'Domain']) {
      await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/columns`,
        headers,
        payload: { name, type: 'text', kind: 'input', config: {} },
      });
    }
    for (const [company, domain] of [
      ['Acme', 'acme.com'],
      ['Beta', 'beta.com'],
    ]) {
      await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/rows`,
        headers,
        payload: { values: { Company: company, Domain: domain } },
      });
    }
    const fanout = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/fanout`,
      headers,
      payload: {
        provider: 'mock',
        action: 'mock.findPeople',
        input: { domain: '{{Domain}}', limit: 2 },
        carry: ['Company', 'Domain'],
        target: { name: 'People' },
      },
    });
    expect(fanout.json()).toMatchObject({ imported: 4, sourceRows: 2, errors: [] });
    expect(fanout.statusCode).toBe(201);
    const target = fanout.json() as { tableId: string };
    const targetResponse = await instance.inject({
      method: 'GET',
      url: `/tables/${target.tableId}`,
      headers,
    });
    expect(targetResponse.statusCode).toBe(200);
    const targetBody = targetResponse.json() as {
      columns: { id: string; name: string }[];
      rows: { cells: { columnId: string; value: unknown }[] }[];
    };
    const companyId = targetBody.columns.find((column) => column.name === 'Company')?.id;
    expect(
      targetBody.rows.every((row) => row.cells.find((cell) => cell.columnId === companyId)?.value),
    ).toBe(true);
    await app.close();
  });
});
