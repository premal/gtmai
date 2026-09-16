import { describe, expect, it } from 'vitest';
import { compileFilterPredicate, compileFilterWhere } from './filter';

describe('filter DSL', () => {
  it('evaluates nested JSON values and signal predicates', () => {
    const filter = {
      and: [
        { field: 'data.title', op: 'contains' as const, value: 'VP' },
        { field: 'company.data.employees', op: 'gte' as const, value: 200 },
      ],
    };
    expect(
      compileFilterPredicate(filter)({
        data: { title: 'VP Engineering' },
        company: { data: { employees: 500 } },
      }),
    ).toBe(true);
  });

  it('compiles simple fields to a Prisma-compatible where clause', () => {
    expect(compileFilterWhere({ field: 'email', op: 'contains', value: '@example.com' })).toEqual({
      email: { contains: '@example.com', mode: 'insensitive' },
    });
  });
});
