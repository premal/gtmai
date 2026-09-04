import { describe, expect, it } from 'vitest';
import { evaluateWorkerFormula, hasMissingInputs, startWorker } from './main';

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
});
