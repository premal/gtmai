import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './main';
import { AuthService } from './auth/auth.service';
import { PrismaService } from './prisma/prisma.service';
import { createWorkspaceWithAdmin } from './test-helpers';

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

describe('metaprompt + table-scoped signals', () => {
  it('rejects generation without an LLM connection and validates signal scope', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      `metaprompt-${Date.now()}@gtmai.dev`,
      'Metaprompt User',
    );
    const headers = { authorization: `Bearer ${auth.token}` };
    const tableResponse = await instance.inject({
      method: 'POST',
      url: `/workspaces/${auth.workspaceId}/tables`,
      headers,
      payload: { name: 'Leads' },
    });
    expect(tableResponse.statusCode).toBe(201);
    const table = tableResponse.json() as { id: string };

    const metaprompt = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/metaprompt`,
      headers,
      payload: { description: 'Visit each company website and decide if they sell B2B' },
    });
    expect(metaprompt.statusCode).toBe(400);
    expect(metaprompt.json()).toMatchObject({ message: expect.stringContaining('LLM') });

    const condition = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/run-condition`,
      headers,
      payload: { description: 'only when B2B is checked' },
    });
    expect(condition.statusCode).toBe(400);

    const sequence = await instance.inject({
      method: 'POST',
      url: '/sequences/generate',
      headers,
      payload: { name: 'Gen seq', description: 'Reach out to new CMOs at B2B companies' },
    });
    expect(sequence.statusCode).toBe(400);

    const badTable = await instance.inject({
      method: 'POST',
      url: '/signals/definitions',
      headers,
      payload: {
        name: 'Scoped to missing table',
        type: 'funding',
        config: { sourceTableId: 'missing-table' },
      },
    });
    expect(badTable.statusCode).toBe(404);

    const badChannel = await instance.inject({
      method: 'POST',
      url: '/signals/definitions',
      headers,
      payload: {
        name: 'Missing channel',
        type: 'funding',
        config: { alertChannelId: 'missing-channel' },
      },
    });
    expect(badChannel.statusCode).toBe(404);

    const channelResponse = await instance.inject({
      method: 'POST',
      url: '/usage/channels',
      headers,
      payload: { url: 'https://hooks.example.com/test' },
    });
    expect(channelResponse.statusCode).toBe(201);
    const channel = channelResponse.json() as { id: string };
    const channels = await instance.inject({
      method: 'GET',
      url: '/usage/channels',
      headers,
    });
    expect(channels.statusCode).toBe(200);
    expect((channels.json() as { id: string }[]).some((item) => item.id === channel.id)).toBe(true);

    const definition = await instance.inject({
      method: 'POST',
      url: '/signals/definitions',
      headers,
      payload: {
        name: 'Table funding monitor',
        type: 'funding',
        config: {
          provider: 'mock',
          schedule: 'weekly',
          sourceTableId: table.id,
          alertChannelId: channel.id,
        },
      },
    });
    expect(definition.statusCode).toBe(201);
    const created = definition.json() as { config: Record<string, unknown> };
    expect(created.config.sourceTableId).toBe(table.id);
    expect(created.config.alertChannelId).toBe(channel.id);
    await app.close();
  });
});
