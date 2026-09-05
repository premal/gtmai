import { describe, expect, it, vi } from 'vitest';
import { runAgentWithClient } from './llm';

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
});
