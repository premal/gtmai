import { describe, expect, it, vi } from 'vitest';
import { runAgentWithClient, webSearch } from './llm';

describe('agent loop', () => {
  it('uses search, fetch, and finish tools within the step limit', async () => {
    const responses = [
      JSON.stringify({ tool: 'web_search', arguments: { query: 'Ada Lovelace' } }),
      JSON.stringify({ tool: 'fetch_page', arguments: { url: 'https://example.com/ada' } }),
      JSON.stringify({
        tool: 'finish',
        result: {
          answer: 'Ada was a pioneer.',
          fields: { role: 'mathematician' },
          sources: [],
          reasoning: 'researched',
        },
      }),
    ];
    const client = { complete: vi.fn(async () => responses.shift() ?? '{}') };
    const context = {
      credentials: {},
      fetch: vi.fn(async (url: string) =>
        url.includes('duckduckgo')
          ? new Response('<a class="result__a" href="https://example.com/ada">Ada</a>')
          : new Response('<html><body>Ada Lovelace</body></html>'),
      ) as unknown as typeof fetch,
      logger: { info: () => undefined, error: () => undefined },
    };
    const result = await runAgentWithClient('Find Ada', context, client);
    expect(result.answer).toContain('pioneer');
    expect(result.sources).toContain('https://example.com/ada');
    expect(client.complete).toHaveBeenCalledTimes(3);
  });

  it('normalizes incomplete and top-level finish payloads', async () => {
    const incomplete = await runAgentWithClient(
      'Find Ada',
      {
        credentials: {},
        fetch: vi.fn() as unknown as typeof fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
      { complete: vi.fn(async () => JSON.stringify({ tool: 'finish', result: { answer: 'ok' } })) },
    );
    expect(incomplete).toMatchObject({
      answer: 'ok',
      fields: {},
      sources: [],
      reasoning: '',
    });

    const topLevel = await runAgentWithClient(
      'Find Clay',
      {
        credentials: {},
        fetch: vi.fn() as unknown as typeof fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
      {
        complete: vi.fn(async () =>
          JSON.stringify({ fields: { uses_clay: 'likely' }, answer: 'Uses Clay.' }),
        ),
      },
    );
    expect(topLevel).toMatchObject({
      answer: 'Uses Clay.',
      fields: { uses_clay: 'likely' },
      sources: [],
      reasoning: '',
    });
  });

  it('decodes DuckDuckGo redirects and uses result snippets', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(`
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstory&amp;rut=abc">Story</a>
        <div class="result__snippet">A <b>useful</b> search snippet.</div>
      `),
    );
    const result = await webSearch('Clay', {
      credentials: {},
      fetch: fetcher as unknown as typeof fetch,
      logger: { info: () => undefined, error: () => undefined },
    });
    expect(result.sources).toEqual(['https://example.com/story']);
    expect(result.text).toBe('A useful search snippet.');
  });

  it('repairs empty fields from a follow-up structured response', async () => {
    const client = {
      complete: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            tool: 'finish',
            result: { answer: 'The company uses the technology.', fields: {} },
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ fields: { uses_clay: 'yes' } })),
    };
    const result = await runAgentWithClient(
      'Research whether the company uses Clay. Finish with fields: uses_clay.',
      {
        credentials: {},
        fetch: vi.fn() as unknown as typeof fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
      client,
    );
    expect(result.fields).toEqual({ uses_clay: 'yes' });
    expect(client.complete).toHaveBeenCalledTimes(2);
  });
});
