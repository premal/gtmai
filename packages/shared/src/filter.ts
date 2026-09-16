import { z } from 'zod';

export const filterOperatorSchema = z.enum([
  'eq',
  'neq',
  'contains',
  'in',
  'gte',
  'lte',
  'exists',
  'has',
]);

export const filterRuleSchema = z.object({
  field: z.string().min(1),
  op: filterOperatorSchema,
  value: z.unknown().optional(),
});

export type FilterRule = z.infer<typeof filterRuleSchema>;
export type FilterGroup = {
  and?: Filter[];
  or?: Filter[];
};
export type Filter = FilterRule | FilterGroup;

const filterGroupSchema = z.object({
  and: z.array(z.lazy(() => filterSchema)).optional(),
  or: z.array(z.lazy(() => filterSchema)).optional(),
});
export const filterSchema = z.lazy(() =>
  z
    .union([filterRuleSchema, filterGroupSchema])
    .refine((value) => 'field' in value || 'and' in value || 'or' in value),
) as z.ZodType<Filter>;

function pathValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function isGroup(filter: Filter): filter is FilterGroup {
  return 'and' in filter || 'or' in filter;
}

function compare(rule: FilterRule, source: unknown): boolean {
  const actual = pathValue(source, rule.field);
  switch (rule.op) {
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(rule.value ?? '').toLowerCase());
    case 'in':
      return Array.isArray(rule.value) && rule.value.some((value) => value === actual);
    case 'gte':
      return Number(actual) >= Number(rule.value);
    case 'lte':
      return Number(actual) <= Number(rule.value);
    case 'exists':
      return rule.value === false
        ? actual === undefined || actual === null
        : actual !== undefined && actual !== null;
    case 'has':
      if (Array.isArray(actual)) {
        return actual.some((value) =>
          typeof value === 'object' && value !== null
            ? evaluateFilter(rule.value as Filter, value)
            : value === rule.value,
        );
      }
      return false;
  }
}

export function compileFilterPredicate(filter: Filter): (source: unknown) => boolean {
  return (source) => evaluateFilter(filter, source);
}

export function evaluateFilter(filter: Filter, source: unknown): boolean {
  if (isGroup(filter)) {
    const and = filter.and ?? [];
    const or = filter.or ?? [];
    return (
      and.every((child) => evaluateFilter(child, source)) &&
      (or.length === 0 || or.some((child) => evaluateFilter(child, source)))
    );
  }
  return compare(filter, source);
}

export function compileFilterWhere(filter: Filter): Record<string, unknown> {
  if (isGroup(filter) && filter.and) {
    return { AND: filter.and.map((item) => compileFilterWhere(item)) };
  }
  if (isGroup(filter) && filter.or) {
    return { OR: filter.or.map((item) => compileFilterWhere(item)) };
  }
  if (isGroup(filter)) return {};
  const field = filter.field;
  const value = filter.value;
  if (field.includes('.')) {
    return {};
  }
  switch (filter.op) {
    case 'eq':
      return { [field]: value };
    case 'neq':
      return { [field]: { not: value } };
    case 'contains':
      return { [field]: { contains: String(value ?? ''), mode: 'insensitive' } };
    case 'in':
      return { [field]: { in: Array.isArray(value) ? value : [] } };
    case 'gte':
      return { [field]: { gte: value } };
    case 'lte':
      return { [field]: { lte: value } };
    case 'exists':
      return { [field]: value === false ? null : { not: null } };
    case 'has':
      return {};
  }
}
