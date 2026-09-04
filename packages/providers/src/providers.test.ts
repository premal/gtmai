import { describe, expect, it, vi } from 'vitest';
import {
  apolloProvider,
  datagmaProvider,
  httpProvider,
  hunterProvider,
  mockProvider,
  pdlProvider,
  prospeoProvider,
} from './index';

const context = (fetcher: typeof fetch) => ({
  credentials: { apiKey: 'test-key' },
  fetch: fetcher,
  logger: { info: () => undefined, error: () => undefined },
});

describe('providers', () => {
  it('mock is deterministic', async () => {
    const input = { firstName: 'Ada', lastName: 'Lovelace', domain: 'example.com' };
    const a = await mockProvider.actions[0]!.run(input, context(fetch));
    const b = await mockProvider.actions[0]!.run(input, context(fetch));
    expect(a).toEqual(b);
  });

  it('http adapter parses json', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const result = await httpProvider.actions[0]!.run(
      { method: 'GET', url: 'https://example.com' },
      context(fetcher),
    );
    expect(result).toEqual({ found: true, data: { ok: true } });
  });

  it.each([
    [hunterProvider, { first_name: 'Ada', domain: 'example.com' }],
    [prospeoProvider, { first_name: 'Ada', domain: 'example.com' }],
    [datagmaProvider, { first_name: 'Ada', domain: 'example.com' }],
    [apolloProvider, { first_name: 'Ada', domain: 'example.com' }],
    [pdlProvider, { domain: 'example.com' }],
  ])('%s sends a provider-specific request and normalizes the result', async (provider, input) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { email: 'ada@example.com', first_name: 'Ada' } }), {
        status: 200,
      }),
    );
    const result = await provider.actions[0]!.run(input, context(fetcher));
    expect(result.found).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('https://api.'),
      expect.anything(),
    );
    if (result.found) expect(result.data).toMatchObject({ email: 'ada@example.com' });
  });
});
