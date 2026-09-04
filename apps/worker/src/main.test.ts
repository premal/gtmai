import { describe, expect, it } from 'vitest';
import { evaluateWorkerFormula, startWorker } from './main';

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
});
