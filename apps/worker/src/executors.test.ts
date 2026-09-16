import { describe, expect, it, vi } from 'vitest';
import {
  acceptsWaterfallResult,
  executeFormula,
  executeWaterfall,
  isValidationAccepted,
} from './executors';

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

  it('rejects only explicitly invalid validation verdicts', () => {
    expect(isValidationAccepted({ status: 'valid', valid: true })).toBe(true);
    expect(isValidationAccepted({ emailStatus: 'verified' })).toBe(true);
    expect(isValidationAccepted({ email: 'a@b.com' })).toBe(true);
    expect(isValidationAccepted({ status: 'invalid' })).toBe(false);
    expect(isValidationAccepted({ email_status: 'undeliverable' })).toBe(false);
    expect(isValidationAccepted({ valid: false })).toBe(false);
    expect(isValidationAccepted({ verdict: 'Bounced' })).toBe(false);
    expect(isValidationAccepted('not-an-object')).toBe(true);
  });

  it('validates waterfall results and falls through to the next provider', async () => {
    const run = vi.fn(
      async (providerId: string, actionId: string, input: Record<string, unknown>) => {
        if (actionId === 'p1.find') {
          return {
            result: { found: true, data: { email: 'bad@x.com' } },
            action: { creditCost: 2 },
            provider: providerId,
          };
        }
        if (actionId === 'p2.find') {
          return {
            result: { found: true, data: { email: 'good@x.com' } },
            action: { creditCost: 3 },
            provider: providerId,
          };
        }
        if (actionId === 'v.verify') {
          const invalid = String(input.email).startsWith('bad');
          return {
            result: { found: true, data: { status: invalid ? 'invalid' : 'valid' } },
            action: { creditCost: 1 },
            provider: providerId,
          };
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    );

    const result = await executeWaterfall(
      {
        providers: [
          { provider: 'p1', action: 'p1.find', input: { domain: '{{Domain}}' } },
          { provider: 'p2', action: 'p2.find', input: { domain: '{{Domain}}' } },
        ],
        validate: { provider: 'v', action: 'v.verify' },
      },
      { Domain: 'x.com' },
      'ws',
      run as never,
    );

    expect(result.provider).toBe('p2');
    expect(run).toHaveBeenCalledTimes(4);
    // Winner's cost (3) plus one validation call per attempt (1 + 1).
    expect(result.creditsUsed).toBe(5);
  });
});
