import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

  it('generates drafts, run conditions, and sequences through a stubbed LLM', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      `llm-happy-${Date.now()}@gtmai.dev`,
      'LLM User',
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
    await app.get(PrismaService).column.create({
      data: {
        tableId: table.id,
        name: 'Domain',
        kind: 'input',
        type: 'text',
        position: 0,
        config: {},
      },
    });
    const integration = await instance.inject({
      method: 'POST',
      url: '/integrations',
      headers,
      payload: { provider: 'openai', name: 'OpenAI', credentials: { apiKey: 'sk-test' } },
    });
    expect(integration.statusCode).toBe(201);

    const replies: string[] = [];
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: replies.shift() ?? '{}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      replies.push(
        'not valid json',
        JSON.stringify({
          name: 'B2B check',
          kind: 'agent',
          type: 'boolean',
          config: {
            prompt: 'Visit {{Domain}} and decide if the company sells B2B',
            outputFields: { answer: 'boolean' },
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
          runCondition: 'len(trim({{Domain}})) > 0',
        }),
      );
      const metaprompt = await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/metaprompt`,
        headers,
        payload: { description: 'Decide if each company sells B2B' },
      });
      expect(metaprompt.statusCode).toBe(201);
      expect(fetcher).toHaveBeenCalledTimes(2); // retried after invalid JSON
      expect(metaprompt.json()).toMatchObject({
        name: 'B2B check',
        kind: 'agent',
        type: 'boolean',
        runCondition: 'len(trim({{Domain}})) > 0',
      });

      replies.push(JSON.stringify({ expression: 'len(trim({{Domain}})) > 0' }));
      const condition = await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/run-condition`,
        headers,
        payload: { description: 'only when the company has a domain' },
      });
      expect(condition.statusCode).toBe(201);
      expect(condition.json()).toEqual({ expression: 'len(trim({{Domain}})) > 0' });

      replies.push(
        JSON.stringify({
          steps: [
            {
              delayHours: 0,
              subjectTemplate: 'Hi {{contact.firstName}}',
              bodyTemplate: 'Hello {{contact.firstName}} — quick question about {{company.name}}.',
            },
            {
              delayHours: 48,
              subjectTemplate: 'Re: {{company.name}}',
              bodyTemplate: 'Following up on my note to {{contact.email}}.',
            },
          ],
        }),
      );
      const sequence = await instance.inject({
        method: 'POST',
        url: '/sequences/generate',
        headers,
        payload: { name: 'Outreach', description: 'Two-step intro', steps: 2 },
      });
      expect(sequence.statusCode).toBe(201);
      const created = sequence.json() as {
        name: string;
        steps: { position: number; delayHours: number; bodyTemplate: string }[];
      };
      expect(created.name).toBe('Outreach');
      expect(created.steps.map((step) => [step.position, step.delayHours])).toEqual([
        [0, 0],
        [1, 48],
      ]);
      expect(created.steps[0]?.bodyTemplate).toContain('{{company.name}}');
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
