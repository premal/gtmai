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
const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration('api smoke', () => {
  it('registers, logs in, creates a table, adds a column, and queues a run', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `smoke-${Date.now()}@gtmai.dev`;
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      email,
      'Smoke User',
    );
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
    const firstName = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/columns`,
      headers: { authorization: `Bearer ${auth.token}` },
      payload: {
        name: 'First name',
        type: 'text',
        kind: 'input',
        config: {},
      },
    });
    expect(firstName.statusCode).toBe(201);
    const lastName = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/columns`,
      headers: { authorization: `Bearer ${auth.token}` },
      payload: {
        name: 'Last name',
        type: 'text',
        kind: 'input',
        config: {},
      },
    });
    expect(lastName.statusCode).toBe(201);
    const boundary = `----gtmai-${Date.now()}`;
    const mapping = JSON.stringify({ given: 'First name', surname: 'Last name' });
    const multipart = [
      `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n`,
      mapping,
      '\r\n',
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="people.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      'given,surname\r\nGrace,Hopper\r\n',
      `\r\n--${boundary}--\r\n`,
    ].join('');
    const imported = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/import`,
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart,
    });
    expect(imported.statusCode).toBe(201);
    const importedTable = await instance.inject({
      method: 'GET',
      url: `/tables/${table.id}`,
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(importedTable.statusCode).toBe(200);
    const tableBody = importedTable.json() as {
      columns: { id: string; name: string }[];
      rows: { cells: { value: unknown; columnId: string }[] }[];
    };
    const importedValues = tableBody.rows.at(-1)?.cells;
    const columnNameById = new Map(tableBody.columns.map((item) => [item.id, item.name]));
    expect(
      importedValues?.some(
        (cell) => columnNameById.get(cell.columnId) === 'First name' && cell.value === 'Grace',
      ),
    ).toBe(true);
    expect(
      importedValues?.some(
        (cell) => columnNameById.get(cell.columnId) === 'Last name' && cell.value === 'Hopper',
      ),
    ).toBe(true);
    const unknownSource = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/source`,
      headers: { authorization: `Bearer ${auth.token}` },
      payload: {
        provider: 'unknown-provider',
        action: 'unknown.search',
        input: {},
      },
    });
    expect(unknownSource.statusCode).toBe(400);
    expect(unknownSource.json()).toMatchObject({
      statusCode: 400,
      message: 'Unknown search action: unknown-provider/unknown.search',
    });
    await app.close();
  });

  it('imports a table into audiences, refreshes a segment, and queues a workflow run', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const email = `audience-${Date.now()}@gtmai.dev`;
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      email,
      'Audience User',
    );
    const headers = { authorization: `Bearer ${auth.token}` };
    const tableResponse = await instance.inject({
      method: 'POST',
      url: `/workspaces/${auth.workspaceId}/tables`,
      headers,
      payload: { name: 'Audience import' },
    });
    const table = tableResponse.json() as { id: string };
    for (const [name, type] of [
      ['Email', 'email'],
      ['First name', 'text'],
      ['Domain', 'url'],
    ] as const) {
      await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/columns`,
        headers,
        payload: { name, type, kind: 'input', config: {} },
      });
    }
    await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/rows`,
      headers,
      payload: {
        values: { Email: 'phase2@example.com', 'First name': 'Phase', Domain: 'example.com' },
      },
    });
    const imported = await instance.inject({
      method: 'POST',
      url: `/audiences/import/table/${table.id}`,
      headers,
      payload: { mapping: { email: 'Email', firstName: 'First name', domain: 'Domain' } },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      contactsCreated: 1,
      contactsUpdated: 0,
      companiesCreated: 1,
      companiesUpdated: 0,
      skipped: 0,
    });
    const importedAgain = await instance.inject({
      method: 'POST',
      url: `/audiences/import/table/${table.id}`,
      headers,
      payload: { mapping: { email: 'Email', firstName: 'First name', domain: 'Domain' } },
    });
    expect(importedAgain.statusCode).toBe(201);
    expect(importedAgain.json()).toMatchObject({
      contactsCreated: 0,
      contactsUpdated: 1,
      companiesCreated: 0,
      companiesUpdated: 1,
      skipped: 0,
    });
    const contacts = await instance.inject({
      method: 'GET',
      url: '/audiences/contacts?limit=100',
      headers,
    });
    expect(contacts.json().items).toHaveLength(1);
    const segment = await instance.inject({
      method: 'POST',
      url: '/audiences/segments',
      headers,
      payload: {
        name: 'Imported contacts',
        filter: { field: 'email', op: 'contains', value: 'phase2@' },
      },
    });
    const segmentBody = segment.json() as { id: string };
    const refreshed = await instance.inject({
      method: 'POST',
      url: `/audiences/segments/${segmentBody.id}/refresh`,
      headers,
    });
    expect(refreshed.json()).toMatchObject({ count: 1 });
    const exported = await instance.inject({
      method: 'POST',
      url: '/audiences/export/table',
      headers,
      payload: { name: 'Imported export', segmentId: segmentBody.id },
    });
    expect(exported.statusCode).toBe(201);
    const exportedBody = exported.json() as { tableId: string; rows: number };
    expect(exportedBody.rows).toBe(1);
    const exportedTable = await instance.inject({
      method: 'GET',
      url: `/tables/${exportedBody.tableId}`,
      headers,
    });
    expect(exportedTable.statusCode).toBe(200);
    expect(exportedTable.json().rows).toHaveLength(1);
    const workflow = await instance.inject({
      method: 'POST',
      url: '/workflows',
      headers,
      payload: {
        name: 'Phase 2 workflow',
        graph: {
          nodes: [{ id: 'trigger', type: 'trigger.manual', config: {}, position: { x: 0, y: 0 } }],
          edges: [],
        },
      },
    });
    const workflowBody = workflow.json() as { id: string };
    const run = await instance.inject({
      method: 'POST',
      url: `/workflows/${workflowBody.id}/run`,
      headers,
      payload: { source: 'integration' },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ workflowId: workflowBody.id, status: 'queued' });
    await app.close();
  });

  it('serves grouped provider catalog, verifies keys via check(), and previews an agent', async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const auth = await createWorkspaceWithAdmin(
      app.get(PrismaService),
      app.get(AuthService),
      `integrations-${Date.now()}@gtmai.dev`,
      'Integrations User',
    );
    const headers = { authorization: `Bearer ${auth.token}` };

    const catalog = await instance.inject({
      method: 'GET',
      url: '/integrations/catalog',
      headers,
    });
    expect(catalog.statusCode).toBe(200);
    const catalogProviders = catalog.json() as {
      id: string;
      group: string;
      models?: string[];
      auth: { fields: { key: string }[] };
    }[];
    const byId = new Map(catalogProviders.map((item) => [item.id, item]));
    expect(byId.has('llm')).toBe(false);
    for (const id of ['openai', 'anthropic', 'gemini', 'perplexity', 'openrouter', 'cometapi']) {
      const entry = byId.get(id);
      expect(entry?.group).toBe('ai');
      expect(entry?.models?.length).toBeGreaterThan(0);
      expect(entry?.auth.fields.map((field) => field.key)).toEqual(['apiKey']);
    }
    for (const id of ['tavily', 'exa', 'parallel']) {
      expect(byId.get(id)?.group).toBe('search');
    }
    expect(byId.get('hunter')?.group).toBe('enrichment');

    const missing = await instance.inject({
      method: 'POST',
      url: '/integrations',
      headers,
      payload: { provider: 'openrouter', name: 'Router', credentials: {} },
    });
    expect(missing.statusCode).toBe(400);
    const created = await instance.inject({
      method: 'POST',
      url: '/integrations',
      headers,
      payload: {
        provider: 'openrouter',
        name: 'Router',
        credentials: { apiKey: 'sk-or-test' },
      },
    });
    expect(created.statusCode).toBe(201);
    const integrationBody = created.json() as { id: string };
    expect(JSON.stringify(created.json())).not.toContain('sk-or-test');
    const tavily = await instance.inject({
      method: 'POST',
      url: '/integrations',
      headers,
      payload: { provider: 'tavily', name: 'Search', credentials: { apiKey: 'tvly-secret' } },
    });
    expect(tavily.statusCode).toBe(201);

    const tableResponse = await instance.inject({
      method: 'POST',
      url: `/workspaces/${auth.workspaceId}/tables`,
      headers,
      payload: { name: 'Agent table' },
    });
    const table = tableResponse.json() as { id: string };
    await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/columns`,
      headers,
      payload: { name: 'Company', type: 'text', kind: 'input', config: {} },
    });
    const agentColumn = await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/columns`,
      headers,
      payload: {
        name: 'Agent',
        type: 'json',
        kind: 'agent',
        config: {
          prompt: 'Research {{Company}}',
          outputFields: { answer: 'string' },
          provider: 'openrouter',
          model: 'openai/gpt-4o',
        },
      },
    });
    expect(agentColumn.statusCode).toBe(201);
    const agentColumnId = (agentColumn.json() as { id: string }).id;
    await instance.inject({
      method: 'POST',
      url: `/tables/${table.id}/rows`,
      headers,
      payload: { values: { Company: 'Acme' } },
    });

    const chatResponse = (content: string) =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'openai/gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    let chatCalls = 0;
    const fetcher = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [{ title: 'Acme', url: 'https://acme.com', content: 'Acme makes anvils' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('openrouter.ai') && url.includes('auth/key')) {
        return new Response('{}', { status: 401 });
      }
      if (url.includes('openrouter.ai')) {
        chatCalls += 1;
        return chatResponse(
          chatCalls === 1
            ? JSON.stringify({ tool: 'web_search', arguments: { query: 'acme' } })
            : JSON.stringify({
                tool: 'finish',
                result: { answer: 'done', fields: {}, sources: [], reasoning: '' },
              }),
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const tested = await instance.inject({
        method: 'POST',
        url: `/integrations/${integrationBody.id}/test`,
        headers,
      });
      // The check endpoint hits /auth/key, which our stub 401s → rejected.
      expect(tested.json()).toMatchObject({
        ok: false,
        provider: 'openrouter',
        message: 'OpenRouter rejected the API key',
      });

      const preview = await instance.inject({
        method: 'POST',
        url: `/tables/${table.id}/columns/${agentColumnId}/preview`,
        headers,
      });
      expect(preview.statusCode).toBe(201);
      const previews = (
        preview.json() as { previews: { value?: { answer: string; sources: string[] } }[] }
      ).previews;
      expect(previews[0]?.value?.answer).toBe('done');
      expect(previews[0]?.value?.sources).toContain('https://acme.com');

      const urls = fetcher.mock.calls.map((call) => {
        const input = call[0];
        return typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      });
      expect(urls.some((url) => url.includes('openrouter.ai'))).toBe(true);
      expect(urls.some((url) => url.includes('api.tavily.com'))).toBe(true);
      const chatCall = fetcher.mock.calls.find((call) =>
        String(call[0]).includes('chat/completions'),
      );
      expect(chatCall).toBeDefined();
      const chatBody = JSON.parse(String(chatCall?.[1]?.body)) as {
        model?: string;
      };
      expect(chatBody.model).toBe('openai/gpt-4o');
    } finally {
      vi.unstubAllGlobals();
    }

    const list = await instance.inject({
      method: 'GET',
      url: '/integrations',
      headers,
    });
    const items = list.json() as { provider: string; usedInColumns: number }[];
    expect(items.find((item) => item.provider === 'openrouter')?.usedInColumns).toBe(1);
    expect(items.find((item) => item.provider === 'tavily')?.usedInColumns).toBe(0);
    await app.close();
  });
});
