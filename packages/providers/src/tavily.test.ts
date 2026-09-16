import { describe, expect, it, vi } from 'vitest';
import { tavilyProvider } from './tavily';
import type { RunContext } from './types';

const testContext = (fetcher: typeof fetch): RunContext => ({
  credentials: { apiKey: 'tvly-test' },
  fetch: fetcher,
  logger: { info: () => undefined, error: () => undefined },
});

describe('tavilyProvider', () => {
  it('declares an apiKey credential and a web search action', () => {
    expect(tavilyProvider.id).toBe('tavily');
    expect(tavilyProvider.auth.fields.map((field) => field.key)).toEqual(['apiKey']);
    expect(tavilyProvider.actions.map((action) => action.id)).toEqual(['tavily.search']);
  });

  it('tavily.search posts the query with the api key', async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [{ title: 'Acme', url: 'https://acme.com', content: 'Acme makes anvils' }],
          }),
          { status: 200 },
        ),
    );
    const result = await tavilyProvider.actions[0]!.run(
      { query: 'acme', maxResults: 3 },
      testContext(fetcher as unknown as typeof fetch),
    );
    expect(result).toMatchObject({
      found: true,
      data: { results: [{ title: 'Acme', url: 'https://acme.com' }] },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.tavily.com/search');
    expect(String((init as RequestInit).body)).toContain('"api_key":"tvly-test"');
    expect(String((init as RequestInit).body)).toContain('"max_results":3');
  });

  it('check() validates the key via the search endpoint', async () => {
    const fetcher = vi.fn(
      async (_input: string) => new Response('{"results":[]}', { status: 200 }),
    );
    const result = await tavilyProvider.check!(testContext(fetcher as unknown as typeof fetch));
    expect(result).toEqual({ ok: true });
  });

  it('check() reports rejected credentials', async () => {
    const fetcher = vi.fn(
      async (_input: string) => new Response('{"detail":{"error":"bad key"}}', { status: 401 }),
    );
    const result = await tavilyProvider.check!(testContext(fetcher as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, message: 'Tavily rejected the API key' });
  });
});
