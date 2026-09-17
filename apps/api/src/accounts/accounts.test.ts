import { describe, expect, it } from 'vitest';
import { buildAccountWhere } from './accounts.controller';

describe('buildAccountWhere', () => {
  it('builds a search across name/domain/linkedin/ticker', () => {
    const where = buildAccountWhere({ q: 'acme' });
    expect(where.OR).toHaveLength(4);
    expect(where.OR?.[0]).toEqual({ name: { contains: 'acme', mode: 'insensitive' } });
  });

  it('combines facets and ranges', () => {
    const where = buildAccountWhere({
      industry: 'software',
      state: 'California',
      size: '1001-5000',
      minEmployees: 500,
      maxRevenue: 2000,
    });
    expect(where.industry).toEqual({ in: ['software'], mode: 'insensitive' });
    expect(where.state).toEqual({ in: ['California'], mode: 'insensitive' });
    expect(where.size).toEqual({ in: ['1001-5000'] });
    expect(where.employees).toEqual({ gte: 500 });
    expect(where.revenueUsdM).toEqual({ lte: 2000 });
  });

  it('splits comma-separated multi-select values', () => {
    const where = buildAccountWhere({
      industry: 'Retail,Internet',
      state: 'Texas,California',
      size: '1-10,11-50',
    });
    expect(where.industry).toEqual({ in: ['Retail', 'Internet'], mode: 'insensitive' });
    expect(where.state).toEqual({ in: ['Texas', 'California'], mode: 'insensitive' });
    expect(where.size).toEqual({ in: ['1-10', '11-50'] });
  });

  it('filters on attribute presence', () => {
    expect(buildAccountWhere({ hasDomain: 'true' }).domain).toEqual({ not: null });
    expect(buildAccountWhere({ hasDomain: 'false' }).domain).toBeNull();
    expect(buildAccountWhere({ hasLinkedin: 'true' }).linkedinUrl).toEqual({ not: null });
    expect(buildAccountWhere({ hasLinkedin: 'false' }).linkedinUrl).toBeNull();
  });

  it('excludes preserve NULLs', () => {
    const where = buildAccountWhere({ excludeIndustry: 'Retail,Gambling' });
    expect(where.AND).toEqual([
      {
        OR: [
          { industry: null },
          { industry: { notIn: ['Retail', 'Gambling'], mode: 'insensitive' } },
        ],
      },
    ]);
  });

  it('expands US sub-regions to US+state clauses ANDed with explicit states', () => {
    const where = buildAccountWhere({ regions: 'US - West', state: 'Texas,California' });
    expect(where.state).toEqual({ in: ['Texas', 'California'], mode: 'insensitive' });
    expect(where.AND).toEqual([
      {
        OR: [
          {
            AND: [
              { country: { equals: 'united states', mode: 'insensitive' } },
              {
                state: {
                  in: expect.arrayContaining(['california', 'washington']),
                  mode: 'insensitive',
                },
              },
            ],
          },
        ],
      },
    ]);
  });

  it('unions multiple selected regions', () => {
    const where = buildAccountWhere({ regions: 'US - West,US - Northeast' });
    const ors = (where.AND as Array<{ OR: unknown[] }>)[0]?.OR;
    expect(ors).toHaveLength(2);
  });

  it('expands macro regions to country lists', () => {
    const where = buildAccountWhere({ regions: 'EMEA' });
    expect(where.AND).toEqual([
      {
        OR: [
          {
            country: {
              in: expect.arrayContaining(['germany', 'france', 'nigeria']),
              mode: 'insensitive',
            },
          },
        ],
      },
    ]);
  });

  it('excluded regions keep rows with NULL country/state', () => {
    const where = buildAccountWhere({ excludeRegions: 'APAC' });
    expect(where.AND).toEqual([
      {
        NOT: {
          OR: [
            {
              country: {
                in: expect.arrayContaining(['japan', 'australia']),
                mode: 'insensitive',
              },
            },
          ],
        },
      },
    ]);
  });

  it('supports country include and NULL-preserving exclude', () => {
    const where = buildAccountWhere({ country: 'Germany,France', excludeCountry: 'China' });
    expect(where.country).toEqual({ in: ['Germany', 'France'], mode: 'insensitive' });
    expect(where.AND).toEqual([
      { OR: [{ country: null }, { country: { notIn: ['China'], mode: 'insensitive' } }] },
    ]);
  });

  it('parses identifiers into domains or LinkedIn slugs', () => {
    const domains = buildAccountWhere({ identifiers: 'acme.com, https://www.foo.io/path' });
    expect(domains.domain).toEqual({ in: ['acme.com', 'foo.io'] });
    const linkedin = buildAccountWhere({
      identifiers: 'linkedin.com/company/acme https://www.linkedin.com/company/foo/',
    });
    expect(linkedin.AND).toEqual([
      {
        OR: [
          { linkedinUrl: { contains: 'acme', mode: 'insensitive' } },
          { linkedinUrl: { contains: 'foo', mode: 'insensitive' } },
        ],
      },
    ]);
  });

  it('requires every keyword term to match name or industry', () => {
    const where = buildAccountWhere({ keywords: 'solar,roofing' });
    const and = where.AND as import('@gtmai/db').Prisma.AccountWhereInput[];
    expect(and).toHaveLength(2);
    expect(and[0]?.OR).toEqual([
      { name: { contains: 'solar', mode: 'insensitive' } },
      { industry: { contains: 'solar', mode: 'insensitive' } },
    ]);
  });

  it('returns an empty where for no filters', () => {
    expect(buildAccountWhere({})).toEqual({});
  });
});
