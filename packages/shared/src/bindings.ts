export type BindingRow = Record<string, unknown>;
const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

export function resolveBindings(template: string, row: BindingRow): string {
  return template.replace(pattern, (_match, key: string) => {
    const value = getPath(row, key.trim());
    return value === null || value === undefined ? '' : String(value);
  });
}

export function resolveBindingsDeep<T>(value: T, row: BindingRow): T {
  if (typeof value === 'string') {
    const exact = value.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
    if (exact) return getPath(row, exact[1]!.trim()) as T;
    return resolveBindings(value, row) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveBindingsDeep(item, row)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveBindingsDeep(item, row),
      ]),
    ) as T;
  }
  return value;
}

export function findBindings(template: string): string[] {
  return [...template.matchAll(pattern)].map((match) => match[1]!.trim());
}
