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

  it('mock finds deterministic people and respects the limit', async () => {
    const result = await mockProvider.actions
      .find((item) => item.id === 'mock.findPeople')!
      .run({ domain: 'acme.com', limit: 2 }, context(fetch));
    expect(result).toEqual({
      found: true,
      data: {
        people: [
          expect.objectContaining({
            fullName: 'Alex Rivera',
            email: 'alex@acme.com',
          }),
          expect.objectContaining({
            fullName: 'Sam Chen',
            email: 'sam@acme.com',
          }),
        ],
        total: 3,
      },
    });
  });

  it('maps Apollo people search responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          people: [
            {
              first_name: 'Ada',
              last_name: 'Lovelace',
              name: 'Ada Lovelace',
              title: 'VP Engineering',
              seniority: 'vp',
              departments: ['engineering'],
              linkedin_url: 'https://linkedin.com/in/ada',
              email: null,
              email_status: 'locked',
              organization: { name: 'Acme', primary_domain: 'acme.com' },
            },
          ],
          pagination: { total_entries: 1 },
        }),
        { status: 200 },
      ),
    );
    const result = await apolloProvider.actions
      .find((item) => item.id === 'apollo.peopleSearch')!
      .run({ domain: 'acme.com', titles: 'VP Engineering,CTO', limit: 10 }, context(fetcher));
    expect(result).toMatchObject({
      found: true,
      data: {
        people: [
          {
            firstName: 'Ada',
            lastName: 'Lovelace',
            department: 'engineering',
            company: { name: 'Acme', domain: 'acme.com' },
          },
        ],
        total: 1,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.apollo.io/api/v1/mixed_people/search',
      expect.objectContaining({
        body: expect.stringContaining('"q_organization_domains_list":["acme.com"]'),
      }),
    );
  });

  it('maps Hunter domain-search people responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            domain: 'acme.com',
            organization: 'Acme',
            emails: [
              {
                value: 'ada@acme.com',
                first_name: 'Ada',
                last_name: 'Lovelace',
                position: 'VP Engineering',
                seniority: 'senior',
                department: 'engineering',
                linkedin: 'https://linkedin.com/in/ada',
                confidence: 94,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const result = await hunterProvider.actions
      .find((item) => item.id === 'hunter.domainSearch')!
      .run({ domain: 'acme.com', limit: 10 }, context(fetcher));
    expect(result).toMatchObject({
      found: true,
      data: {
        people: [
          {
            email: 'ada@acme.com',
            title: 'VP Engineering',
            emailStatus: '94',
            company: { name: 'Acme', domain: 'acme.com' },
          },
        ],
      },
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain('limit=10');
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
