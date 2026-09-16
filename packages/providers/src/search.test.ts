import { describe, expect, it, vi } from 'vitest';
import { exaProvider, parallelProvider } from './search';
import type { RunContext } from './types';

const testContext = (fetcher: typeof fetch): RunContext => ({
  credentials: { apiKey: 'sk-test' },
  fetch: fetcher,
  logger: { info: () => undefined, error: () => undefined },
});

describe('search providers', () => {
  it('exa.search posts the query and maps results', async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [{ title: 'Acme', url: 'https://acme.com', text: 'Acme makes anvils' }],
          }),
          { status: 200 },
        ),
    );
    const result = await exaProvider.actions[0]!.run(
      { query: 'acme', maxResults: 3 },
      testContext(fetcher as unknown as typeof fetch),
    );
    expect(result).toMatchObject({
      found: true,
      data: { results: [{ title: 'Acme', url: 'https://acme.com', content: 'Acme makes anvils' }] },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.exa.ai/search');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'sk-test' });
    expect(String((init as RequestInit).body)).toContain('"numResults":3');
  });

  it('parallel.search posts search_queries and joins excerpts', async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              { title: 'Acme', url: 'https://acme.com', excerpts: ['Acme makes', 'anvils'] },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await parallelProvider.actions[0]!.run(
      { query: 'acme', maxResults: 2 },
      testContext(fetcher as unknown as typeof fetch),
    );
    expect(result).toMatchObject({
      found: true,
      data: {
        results: [{ title: 'Acme', url: 'https://acme.com', content: 'Acme makes\nanvils' }],
      },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.parallel.ai/v1/search');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'sk-test' });
    expect(String((init as RequestInit).body)).toContain('"search_queries":["acme"]');
  });

  it.each([
    [exaProvider, 'https://api.exa.ai/search', 200, true],
    [parallelProvider, 'https://api.parallel.ai/v1/search', 200, true],
    [exaProvider, 'https://api.exa.ai/search', 401, false],
    [parallelProvider, 'https://api.parallel.ai/v1/search', 403, false],
  ])('%s.check probes %s (HTTP %i → ok=%s)', async (provider, url, status, ok) => {
    const fetcher = vi.fn(async (_input: string) => new Response('{}', { status }));
    const result = await provider.check!(testContext(fetcher as unknown as typeof fetch));
    expect(result.ok).toBe(ok);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(url);
  });
});
