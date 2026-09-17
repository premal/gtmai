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

  it('returns an empty where for no filters', () => {
    expect(buildAccountWhere({})).toEqual({});
  });
});
