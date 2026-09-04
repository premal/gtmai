export type BindingRow = Record<string, unknown>;
const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
export function resolveBindings(template: string, row: BindingRow): string {
  return template.replace(pattern, (_match, key: string) => {
    const value = row[key.trim()];
    return value === null || value === undefined ? '' : String(value);
  });
}
export function findBindings(template: string): string[] {
  return [...template.matchAll(pattern)].map((match) => match[1]!.trim());
}
