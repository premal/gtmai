import { describe, expect, it, vi } from 'vitest';
import { theirstackProvider } from './theirstack';

const context = (fetcher: typeof fetch) => ({
  credentials: { apiKey: 'test-key' },
  fetch: fetcher,
  logger: { info: () => undefined, error: () => undefined },
});

describe('TheirStack provider', () => {
  it('maps company technologies and requested matches', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            technologies: [
              { name: 'Salesforce', slug: 'salesforce', confidence: 0.9, jobs_count: 4 },
              { name: 'HubSpot', slug: 'hubspot', last_seen: '2025-01-01' },
            ],
          },
        }),
      ),
    );
    const result = await theirstackProvider.actions[0]!.run(
      { domain: 'example.com', technologies: 'salesforce, clay' },
      context(fetcher),
    );
    expect(result).toEqual({
      found: true,
      data: {
        technologies: [
          {
            name: 'Salesforce',
            slug: 'salesforce',
            confidence: 0.9,
            jobsCount: 4,
            lastSeen: undefined,
          },
          {
            name: 'HubSpot',
            slug: 'hubspot',
            confidence: undefined,
            jobsCount: undefined,
            lastSeen: '2025-01-01',
          },
        ],
        technologyCount: 2,
        matched: ['salesforce'],
        usesTechnology: true,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.theirstack.com/v1/companies/technologies',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        body: JSON.stringify({ company_domain: 'example.com' }),
      }),
    );
  });

  it('searches companies and maps filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              company_name: 'Acme',
              company_domain: 'acme.com',
              employee_count: 42,
              company_country_code: 'US',
              technologies_found: [{ name: 'Salesforce' }],
            },
          ],
          total: 1,
        }),
      ),
    );
    const result = await theirstackProvider.actions[1]!.run(
      { technology: 'salesforce', country: 'US', minEmployees: 10, maxEmployees: 100, limit: 5 },
      context(fetcher),
    );
    expect(result).toMatchObject({
      found: true,
      data: {
        companies: [
          {
            name: 'Acme',
            domain: 'acme.com',
            employees: 42,
            country: 'US',
            technologiesFound: ['Salesforce'],
          },
        ],
        total: 1,
      },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      company_technology_slug_or: ['salesforce'],
      company_country_code_or: ['US'],
      min_employee_count: 10,
      max_employee_count: 100,
      limit: 5,
      page: 0,
    });
  });

  it('returns not-found results for non-2xx responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    const result = await theirstackProvider.actions[0]!.run(
      { domain: 'example.com' },
      context(fetcher),
    );
    expect(result).toEqual({
      found: false,
      reason: 'theirstack.companyTechnologies returned HTTP 401',
    });
  });
});
