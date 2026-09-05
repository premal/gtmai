import { describe, expect, it } from 'vitest';
import { acceptsWaterfallResult, executeFormula } from './executors';

describe('shared worker executors', () => {
  it('evaluates formulas without substituting raw values into the expression', () => {
    expect(
      executeFormula('concat({{First name}}, " ", {{Last name}})', {
        'First name': 'Ada',
        'Last name': 'Lovelace',
      }),
    ).toBe('Ada Lovelace');
  });

  it('enforces the verified email waterfall acceptance rule', () => {
    expect(
      acceptsWaterfallResult(
        { found: true, data: { emailStatus: 'verified' } },
        'verified-email-only',
      ),
    ).toBe(true);
    expect(
      acceptsWaterfallResult(
        { found: true, data: { emailStatus: 'unknown' } },
        'verified-email-only',
      ),
    ).toBe(false);
  });
});
