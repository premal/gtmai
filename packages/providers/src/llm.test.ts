import { describe, expect, it, vi } from 'vitest';
import { fetchPage, parseBing, parseDuckDuckGo, runAgentWithClient, webSearch } from './llm';

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
    const fixture = `
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstory&amp;rut=abc">Story</a>
        <div class="result__snippet">A <b>useful</b> search snippet.</div>
      `;
    const fetcher = vi.fn(async () => new Response(fixture));
    const result = await webSearch('Clay', {
      credentials: {},
      fetch: fetcher as unknown as typeof fetch,
      logger: { info: () => undefined, error: () => undefined },
    });
    expect(result.sources).toEqual(['https://example.com/story']);
    expect(result.text).toBe('A useful search snippet.');
    expect(parseDuckDuckGo(fixture)).toEqual({
      sources: ['https://example.com/story'],
      text: 'A useful search snippet.',
    });
  });

  it('parses Bing result blocks and falls back when DuckDuckGo fails', async () => {
    const encodedSource = `a1${Buffer.from('https://example.com/bing').toString('base64')}`;
    const fixture = `
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?u=${encodedSource}">Bing result</a></h2>
        <p>A <strong>Bing</strong> snippet.</p>
      </li>
    `;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) throw new Error('connect timeout');
      return new Response(fixture);
    });
    const result = await webSearch('Clay', {
      credentials: {},
      fetch: fetcher as unknown as typeof fetch,
      logger: { info: () => undefined, error: () => undefined },
    });
    expect(result).toMatchObject({
      sources: ['https://example.com/bing'],
      text: 'Bing result: A Bing snippet.',
    });
    expect(parseBing(fixture)).toEqual({
      sources: ['https://example.com/bing'],
      text: 'Bing result: A Bing snippet.',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable search backends without throwing', async () => {
    const result = await webSearch('Clay', {
      credentials: {},
      fetch: vi.fn(async () => {
        throw new Error('connect timeout');
      }) as unknown as typeof fetch,
      logger: { info: () => undefined, error: () => undefined },
    });
    expect(result).toEqual({
      text: 'Search unavailable: duckduckgo: connect timeout; bing: connect timeout',
      sources: [],
      unavailable: true,
    });
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

  it('records unavailable search reasoning when no search succeeds', async () => {
    const client = {
      complete: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ tool: 'web_search', arguments: { query: 'Clay' } }))
        .mockResolvedValueOnce(
          JSON.stringify({
            tool: 'finish',
            result: { answer: 'No evidence found.', fields: { uses_clay: 'unknown' } },
          }),
        ),
    };
    const result = await runAgentWithClient(
      'Research whether the company uses Clay. Finish with fields: uses_clay.',
      {
        credentials: {},
        fetch: vi.fn(async () => {
          throw new Error('connect timeout');
        }) as unknown as typeof fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
      client,
    );
    expect(result.reasoning).toContain('search_unavailable: Search unavailable:');
  });

  it('forces a finish response after exhausting tool calls', async () => {
    const responses = Array.from({ length: 12 }, () =>
      JSON.stringify({ tool: 'web_search', arguments: { query: 'Clay' } }),
    );
    responses.push(
      JSON.stringify({
        tool: 'finish',
        result: {
          answer: 'Evidence was inconclusive.',
          fields: { uses_clay: 'unknown' },
          reasoning: '',
        },
      }),
    );
    const client = { complete: vi.fn(async () => responses.shift() ?? '{}') };
    const result = await runAgentWithClient(
      'Research whether the company uses Clay. Finish with fields: uses_clay.',
      {
        credentials: {},
        fetch: vi.fn(
          async () =>
            new Response(
              '<a class="result__a" href="https://example.com">Example</a><div class="result__snippet">Evidence</div>',
            ),
        ) as unknown as typeof fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
      client,
    );
    expect(result.fields).toEqual({ uses_clay: 'unknown' });
    expect(result.reasoning).toBe('max_steps');
    expect(client.complete).toHaveBeenCalledTimes(13);
  });

  it('returns an HTTP error from fetchPage for non-success responses', async () => {
    const result = await fetchPage(
      'https://example.com/missing',
      vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    );
    expect(result).toBe('{"error":"HTTP 404"}');
  });
});
