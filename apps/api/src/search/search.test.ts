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

describe('search', () => {
  it('searches workspace resources by text and all selected tags', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `search-${Date.now()}@gtmai.dev`;
    const otherEmail = `search-other-${Date.now()}@gtmai.dev`;
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      email,
      'Search User',
    );
    const otherAuth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      otherEmail,
      'Other Search User',
    );
    const headers = { authorization: `Bearer ${auth.token}` };
    const otherHeaders = { authorization: `Bearer ${otherAuth.token}` };

    const folder = await instance.inject({
      method: 'POST',
      url: '/folders',
      headers,
      payload: { name: 'Clay campaigns' },
    });
    const workbook = await instance.inject({
      method: 'POST',
      url: '/workbooks',
      headers,
      payload: { name: 'Outbound accounts', folderId: folder.json().id },
    });
    const table = await instance.inject({
      method: 'POST',
      url: '/tables',
      headers,
      payload: { name: 'Clay prospects', workbookId: workbook.json().id },
    });
    const activeTag = await instance.inject({
      method: 'POST',
      url: '/tags',
      headers,
      payload: { name: 'Active', color: '#22c55e' },
    });
    const clayTag = await instance.inject({
      method: 'POST',
      url: '/tags',
      headers,
      payload: { name: 'Clay users', color: '#6366f1' },
    });
    for (const [tagId, body] of [
      [activeTag.json().id, { workbookId: workbook.json().id }],
      [clayTag.json().id, { tableId: table.json().id }],
    ]) {
      await instance.inject({
        method: 'POST',
        url: `/tags/${tagId}/assign`,
        headers,
        payload: body,
      });
    }
    await instance.inject({
      method: 'POST',
      url: '/folders',
      headers: otherHeaders,
      payload: { name: 'Clay campaigns' },
    });

    const byName = await instance.inject({
      method: 'GET',
      url: '/search?q=prospects',
      headers,
    });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: table.json().id,
          workbookName: workbook.json().name,
        }),
      ]),
    );

    const byTagName = await instance.inject({
      method: 'GET',
      url: '/search?q=clay',
      headers,
    });
    expect(byTagName.statusCode).toBe(200);
    expect(byTagName.json().folders).toHaveLength(1);
    expect(byTagName.json().tables).toHaveLength(1);

    const allTags = await instance.inject({
      method: 'GET',
      url: `/search?tagIds=${activeTag.json().id},${clayTag.json().id}`,
      headers,
    });
    expect(allTags.statusCode).toBe(200);
    expect(allTags.json().tables).toHaveLength(0);
    expect(allTags.json().workbooks).toHaveLength(0);

    await instance.inject({
      method: 'POST',
      url: `/tags/${clayTag.json().id}/assign`,
      headers,
      payload: { workbookId: workbook.json().id },
    });
    const allTagsAfter = await instance.inject({
      method: 'GET',
      url: `/search?tagIds=${activeTag.json().id},${clayTag.json().id}`,
      headers,
    });
    expect(allTagsAfter.json().workbooks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workbook.json().id })]),
    );

    const otherWorkspace = await instance.inject({
      method: 'GET',
      url: '/search?q=prospects',
      headers: otherHeaders,
    });
    expect(otherWorkspace.statusCode).toBe(200);
    expect(otherWorkspace.json()).toMatchObject({ folders: [], workbooks: [], tables: [] });

    const empty = await instance.inject({ method: 'GET', url: '/search', headers });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });
});
