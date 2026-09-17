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
    expect(where.industry).toEqual({ equals: 'software', mode: 'insensitive' });
    expect(where.state).toEqual({ equals: 'California', mode: 'insensitive' });
    expect(where.size).toBe('1001-5000');
    expect(where.employees).toEqual({ gte: 500 });
    expect(where.revenueUsdM).toEqual({ lte: 2000 });
  });

  it('returns an empty where for no filters', () => {
    expect(buildAccountWhere({})).toEqual({});
  });
});
