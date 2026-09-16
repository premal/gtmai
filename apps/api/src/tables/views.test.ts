import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../main';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { createWorkspaceWithAdmin } from '../test-helpers';

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

describe('workbooks and views', () => {
  it('creates scoped organization resources and applies a view to table reads', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `views-${Date.now()}@gtmai.dev`;
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      email,
      'Views User',
    );
    const headers = { authorization: `Bearer ${auth.token}` };
    const defaultWorkbooks = await instance.inject({ method: 'GET', url: '/workbooks', headers });
    expect(defaultWorkbooks.statusCode).toBe(200);
    expect(defaultWorkbooks.json()).toHaveLength(1);
    const folder = await instance.inject({
      method: 'POST',
      url: '/folders',
      headers,
      payload: { name: 'Campaigns' },
    });
    const workbook = await instance.inject({
      method: 'POST',
      url: '/workbooks',
      headers,
      payload: { name: 'AI prospects', folderId: folder.json().id },
    });
    const table = await instance.inject({
      method: 'POST',
      url: '/tables',
      headers,
      payload: { name: 'Companies', workbookId: workbook.json().id },
    });
    const tableId = table.json().id as string;
    const domain = await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/columns`,
      headers,
      payload: { name: 'Domain', type: 'text', kind: 'input', config: {} },
    });
    const name = await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/columns`,
      headers,
      payload: { name: 'Company', type: 'text', kind: 'input', config: {} },
    });
    const domainId = domain.json().id as string;
    await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/rows`,
      headers,
      payload: { values: { Domain: 'ai.example', Company: 'AI Labs' } },
    });
    await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/rows`,
      headers,
      payload: { values: { Domain: 'other.example', Company: 'Other' } },
    });
    const view = await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/views`,
      headers,
      payload: {
        name: 'AI only',
        filter: { field: domainId, op: 'contains', value: 'ai' },
        sort: [{ columnId: name.json().id, direction: 'desc' }],
        hiddenColumnIds: [name.json().id],
      },
    });
    const viewed = await instance.inject({
      method: 'GET',
      url: `/tables/${tableId}?viewId=${view.json().id}`,
      headers,
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().rows).toHaveLength(1);
    expect(viewed.json().view.id).toBe(view.json().id);
    await instance.inject({
      method: 'POST',
      url: '/connections',
      headers,
      payload: { provider: 'mock', name: 'Mock', credentials: {} },
    });
    const fanout = await instance.inject({
      method: 'POST',
      url: `/tables/${tableId}/fanout`,
      headers,
      payload: {
        provider: 'mock',
        action: 'mock.findPeople',
        input: { domain: '{{Domain}}', limit: 1 },
        viewId: view.json().id,
        target: { name: 'AI people' },
      },
    });
    expect(fanout.statusCode).toBe(201);
    expect(fanout.json()).toMatchObject({ imported: 1, sourceRows: 1, errors: [] });
    const tag = await instance.inject({
      method: 'POST',
      url: '/tags',
      headers,
      payload: { name: 'Priority', color: '#f00' },
    });
    await instance.inject({
      method: 'POST',
      url: `/tags/${tag.json().id}/assign`,
      headers,
      payload: { workbookId: workbook.json().id },
    });
    const listed = await instance.inject({ method: 'GET', url: '/workbooks', headers });
    expect(
      listed.json().find((item: { id: string }) => item.id === workbook.json().id).tags,
    ).toHaveLength(1);
    const moved = await instance.inject({
      method: 'PATCH',
      url: `/tables/${tableId}`,
      headers,
      payload: { workbookId: defaultWorkbooks.json()[0].id },
    });
    expect(moved.statusCode).toBe(200);
    const deleted = await instance.inject({
      method: 'DELETE',
      url: `/workbooks/${workbook.json().id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(200);
    const deleteLast = await instance.inject({
      method: 'DELETE',
      url: `/workbooks/${defaultWorkbooks.json()[0].id}`,
      headers,
    });
    expect(deleteLast.statusCode).toBe(400);
    await app.close();
  });
});
