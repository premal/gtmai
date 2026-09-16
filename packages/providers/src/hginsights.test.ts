import { describe, expect, it, vi } from 'vitest';
import { hginsightsProvider } from './hginsights';

const context = (fetcher: typeof fetch) => ({
  credentials: { apiKey: 'test-key' },
  fetch: fetcher,
  logger: { info: () => undefined, error: () => undefined },
});

describe('HG Insights provider', () => {
  it('enriches a company and maps technographics', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          companies: [
            {
              firmographics: {
                id: 'ABC123',
                name: 'Acme Corp',
                domain: 'acme.com',
                industry_name: 'Software',
                employees_total: 500,
                employees_band: '500-999',
                revenue_total: 50000000,
                revenue_band: '50M-100M',
                country_code: 'US',
                state_name: 'California',
                city_name: 'San Francisco',
              },
              technographics: {
                installs_count: 2,
                installs: [
                  {
                    product_name: 'Salesforce Sales Cloud',
                    vendor_name: 'Salesforce',
                    product_category_level1_name: 'CRM',
                    product_category_level2_name: 'Sales CRM',
                    product_last_verified_date: '2025-06-01',
                    intensity: 80,
                  },
                  { product_name: 'Marketo', vendor_name: 'Adobe' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await hginsightsProvider.actions
      .find((item) => item.id === 'hginsights.enrichCompany')!
      .run({ domain: 'acme.com', productCategories: 'CRM' }, context(fetcher));
    expect(result).toEqual({
      found: true,
      data: {
        hgId: 'ABC123',
        name: 'Acme Corp',
        domain: 'acme.com',
        industry: 'Software',
        employees: 500,
        employeesBand: '500-999',
        revenue: 50000000,
        revenueBand: '50M-100M',
        country: 'US',
        state: 'California',
        city: 'San Francisco',
        technologies: [
          {
            name: 'Salesforce Sales Cloud',
            vendor: 'Salesforce',
            categories: ['CRM', 'Sales CRM'],
            lastVerified: '2025-06-01',
            intensity: 80,
          },
          {
            name: 'Marketo',
            vendor: 'Adobe',
            categories: [],
            lastVerified: undefined,
            intensity: undefined,
          },
        ],
        technologyCount: 2,
        matched: ['Salesforce Sales Cloud', 'Marketo'],
        usesTechnology: true,
      },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      companies: { domains: ['acme.com'] },
      fields: ['firmographics', 'technographics'],
      filters: {
        technographics: {
          installs: { granularity: 'global' },
          product_categories: { names: ['CRM'] },
        },
      },
      pagination: { technographics: { sort: 'intensity' } },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.hginsights.com/data-api/v2/companies/enrich',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('returns not-found when no company matches', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ companies: [] }), { status: 200 }));
    const result = await hginsightsProvider.actions
      .find((item) => item.id === 'hginsights.enrichCompany')!
      .run({ domain: 'nope.com' }, context(fetcher));
    expect(result).toEqual({ found: false, reason: 'no matching company' });
  });

  it('searches companies with firmographic filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          companies: [
            { id: 'ID1', name: 'Acme', domain: 'acme.com' },
            { id: 'ID2', name: 'Beta', domain: 'beta.io' },
          ],
          count: 42,
        }),
        { status: 200 },
      ),
    );
    const result = await hginsightsProvider.actions
      .find((item) => item.id === 'hginsights.searchCompanies')!
      .run(
        {
          name: 'acme',
          country: 'US',
          minEmployees: 100,
          maxEmployees: 1000,
          limit: 5,
          offset: 10,
        },
        context(fetcher),
      );
    expect(result).toEqual({
      found: true,
      data: {
        companies: [
          { id: 'ID1', name: 'Acme', domain: 'acme.com' },
          { id: 'ID2', name: 'Beta', domain: 'beta.io' },
        ],
        total: 42,
      },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      fields: ['id', 'name', 'domain'],
      filters: {
        company_identifiers: { name: 'acme' },
        firmographics: {
          country_codes: [{ ids: ['US'], inclusion_method: 'ANY_PRESENT' }],
          employees: { min: 100, max: 1000 },
        },
      },
      limit: 5,
      offset: 10,
    });
  });

  it('maps intent signals with global topic granularity', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          company: { id: 'ID1', name: 'Acme', domain: 'acme.com' },
          topics: {
            count: 1,
            data: [
              {
                name: 'Cloud Migration',
                score: 87.5,
                signal_level: 'HIGH',
                trend: 12,
                buyers_journey_names: ['Evaluating'],
                vendor_names: ['AWS'],
                product_names: ['EC2'],
                last_seen_at: '2025-06-01',
              },
            ],
          },
          activities: { count: 3, data: [] },
          summary: {
            active_topics_count: 1,
            high_signal_topics_count: 1,
            latest_signal_date: '2025-06-01',
          },
        }),
        { status: 200 },
      ),
    );
    const result = await hginsightsProvider.actions
      .find((item) => item.id === 'hginsights.intentSignals')!
      .run({ domain: 'acme.com', signalLevels: 'high,medium', limit: 10 }, context(fetcher));
    expect(result).toEqual({
      found: true,
      data: {
        company: { id: 'ID1', name: 'Acme', domain: 'acme.com' },
        topics: [
          {
            name: 'Cloud Migration',
            score: 87.5,
            signalLevel: 'HIGH',
            trend: 12,
            buyersJourney: ['Evaluating'],
            vendors: ['AWS'],
            products: ['EC2'],
            lastSeen: '2025-06-01',
          },
        ],
        topicsCount: 1,
        activeTopicsCount: 1,
        highSignalCount: 1,
        activitiesCount: 3,
        latestSignalDate: '2025-06-01',
      },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      company: { domain: 'acme.com' },
      limit: 10,
      filters: { topics: { granularity: 'global', signal_level: ['HIGH', 'MEDIUM'] } },
    });
  });

  it('returns not-found results for non-2xx responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('nope', { status: 422 }));
    const result = await hginsightsProvider.actions
      .find((item) => item.id === 'hginsights.enrichCompany')!
      .run({ domain: 'acme.com' }, context(fetcher));
    expect(result).toEqual({
      found: false,
      reason: 'hginsights.enrichCompany returned HTTP 422',
    });
  });

  it('check validates the API key via the credits endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"credits": 100}', { status: 200 }));
    const result = await hginsightsProvider.check!(context(fetcher));
    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.hginsights.com/data-api/v2/credits',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('check reports rejected credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    const result = await hginsightsProvider.check!(context(fetcher));
    expect(result).toEqual({ ok: false, message: 'HG Insights rejected the API key' });
  });
});
