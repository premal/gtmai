import { describe, expect, it } from 'vitest';
import { buildSignalTargets, pickSignalColumn } from './signal-targets';

const row = (cells: Record<string, unknown>) => ({
  cells: Object.entries(cells).map(([name, value]) => ({ column: { name }, value })),
});

describe('pickSignalColumn', () => {
  const columns = [{ name: 'Website' }, { name: 'Work Email' }, { name: 'First' }];

  it('prefers the configured column name when it exists', () => {
    expect(pickSignalColumn(columns, 'Work Email', ['email', 'workemail'])).toBe('Work Email');
  });

  it('falls back to aliases when the configured name is absent or unmatched', () => {
    expect(pickSignalColumn(columns, 'Nope', ['email', 'workemail'])).toBe('Work Email');
    expect(pickSignalColumn(columns, undefined, ['domain', 'website'])).toBe('Website');
  });

  it('matches aliases case- and punctuation-insensitively', () => {
    expect(pickSignalColumn([{ name: 'Company_Domain' }], undefined, ['companydomain'])).toBe(
      'Company_Domain',
    );
  });

  it('returns undefined when nothing matches', () => {
    expect(pickSignalColumn(columns, undefined, ['zipcode'])).toBeUndefined();
  });
});

describe('buildSignalTargets', () => {
  const columns = [
    { name: 'Company' },
    { name: 'Website' },
    { name: 'Work Email' },
    { name: 'First' },
    { name: 'Surname' },
  ];

  it('derives company targets from a domain-alias column and dedupes them', () => {
    const targets = buildSignalTargets(
      columns,
      [
        row({ Company: 'Acme', Website: 'acme.com' }),
        row({ Company: 'Acme Dup', Website: 'ACME.com' }),
        row({ Company: 'Globex', Website: 'https://globex.io/about' }),
      ],
      {},
    );
    expect(targets).toEqual([
      {
        scope: 'company',
        entityId: 'acme.com',
        input: { domain: 'acme.com', company: 'Acme' },
      },
      {
        scope: 'company',
        entityId: 'globex.io',
        input: { domain: 'globex.io', company: 'Globex' },
      },
    ]);
  });

  it('derives contact targets from an email-alias column with name fields', () => {
    const targets = buildSignalTargets(
      columns,
      [
        row({ 'Work Email': 'ada@acme.com', First: 'Ada', Surname: 'Lovelace' }),
        row({ 'Work Email': 'ADA@acme.com', First: 'Ada', Surname: 'Lovelace' }),
      ],
      {},
    );
    expect(targets).toEqual([
      {
        scope: 'contact',
        entityId: 'ada@acme.com',
        input: { email: 'ada@acme.com', firstName: 'Ada', lastName: 'Lovelace' },
      },
    ]);
  });

  it('emits both scopes for a row that has domain and email', () => {
    const targets = buildSignalTargets(
      columns,
      [row({ Website: 'acme.com', 'Work Email': 'ada@acme.com' })],
      {},
    );
    expect(targets.map((target) => target.scope)).toEqual(['company', 'contact']);
  });

  it('honors explicitly configured column names', () => {
    const targets = buildSignalTargets(
      [{ name: 'URL' }, { name: 'Website' }],
      [row({ URL: 'acme.com', Website: 'other.com' })],
      { domainColumn: 'URL' },
    );
    expect(targets.map((target) => target.entityId)).toEqual(['acme.com']);
  });

  it('returns no targets when no domain or email column exists', () => {
    expect(buildSignalTargets([{ name: 'Notes' }], [row({ Notes: 'hi' })], {})).toEqual([]);
  });

  it('skips rows with empty domain/email cells', () => {
    const targets = buildSignalTargets(
      columns,
      [row({ Website: '', 'Work Email': '   ' }), row({ Website: 'acme.com' })],
      {},
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.entityId).toBe('acme.com');
  });
});
