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
export function findBindings(template: string): string[] {
  return [...template.matchAll(pattern)].map((match) => match[1]!.trim());
}
