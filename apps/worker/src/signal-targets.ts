import type { Values } from './executors';

export type SignalTarget = {
  scope: 'contact' | 'company';
  entityId: string;
  input: Values;
  contactId?: string;
  companyId?: string;
};

type ColumnLike = { name: string };
type RowLike = { cells: { column: ColumnLike; value: unknown }[] };

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function pickSignalColumn(
  columns: ColumnLike[],
  configured: unknown,
  aliases: string[],
): string | undefined {
  if (typeof configured === 'string' && configured) {
    const named = columns.find((column) => column.name === configured);
    if (named) return named.name;
  }
  return columns.find((column) => aliases.includes(normalizeName(column.name)))?.name;
}

export function buildSignalTargets(
  columns: ColumnLike[],
  rows: RowLike[],
  config: Record<string, unknown>,
): SignalTarget[] {
  const domainColumn = pickSignalColumn(columns, config.domainColumn, [
    'domain',
    'website',
    'companydomain',
    'webdomain',
  ]);
  const emailColumn = pickSignalColumn(columns, config.emailColumn, [
    'email',
    'workemail',
    'emailaddress',
  ]);
  const companyColumn = pickSignalColumn(columns, undefined, [
    'company',
    'companyname',
    'account',
    'accountname',
  ]);
  const firstColumn = pickSignalColumn(columns, undefined, ['firstname', 'first', 'givenname']);
  const lastColumn = pickSignalColumn(columns, undefined, [
    'lastname',
    'last',
    'familyname',
    'surname',
  ]);
  if (!domainColumn && !emailColumn) return [];
  const seen = new Set<string>();
  const targets: SignalTarget[] = [];
  for (const row of rows) {
    const values = Object.fromEntries(row.cells.map((cell) => [cell.column.name, cell.value]));
    const domain = domainColumn
      ? String(values[domainColumn] ?? '')
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, '')
      : '';
    const email = emailColumn ? String(values[emailColumn] ?? '').trim() : '';
    if (domain) {
      const key = `d:${domain.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          scope: 'company',
          entityId: domain.toLowerCase(),
          input: {
            domain,
            company: companyColumn ? String(values[companyColumn] ?? '') : '',
          },
        });
      }
    }
    if (email) {
      const key = `e:${email.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          scope: 'contact',
          entityId: email.toLowerCase(),
          input: {
            email,
            firstName: firstColumn ? String(values[firstColumn] ?? '') : '',
            lastName: lastColumn ? String(values[lastColumn] ?? '') : '',
          },
        });
      }
    }
  }
  return targets;
}
