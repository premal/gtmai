import { describe, expect, it } from 'vitest';
import { evaluateWorkerFormula, exceedsMaxCost, hasMissingInputs, startWorker } from './main';

describe('worker', () => {
  it('exports a worker factory', () => expect(typeof startWorker).toBe('function'));

  it('evaluates the seeded display name expression with column references', () => {
    expect(
      evaluateWorkerFormula('concat({{First name}}, " ", {{Last name}})', {
        'First name': 'Ada',
        'Last name': 'Lovelace',
      }),
    ).toBe('Ada Lovelace');
  });

  it('detects empty resolved provider inputs', () => {
    expect(hasMissingInputs({ firstName: '', domain: null })).toBe(true);
    expect(hasMissingInputs({ firstName: 'Ada', domain: '' })).toBe(false);
  });

  it('skips cells whose estimated cost exceeds maxCost', () => {
    expect(exceedsMaxCost(0.5, 1)).toBe(true);
    expect(exceedsMaxCost(5, 1)).toBe(false);
    expect(exceedsMaxCost(1, 1)).toBe(false);
    expect(exceedsMaxCost(undefined, 10)).toBe(false);
    expect(exceedsMaxCost(0, 10)).toBe(false);
    expect(exceedsMaxCost('2', 3)).toBe(true);
    expect(exceedsMaxCost('abc', 10)).toBe(false);
  });
});
