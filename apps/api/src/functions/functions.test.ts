import { describe, expect, it } from 'vitest';
import { runProgram } from './functions.controller';

describe('function runner', () => {
  it('resolves a dotted output binding', () => {
    expect(runProgram({ output: '{{company.name}}' }, { company: { name: 'Acme' } })).toBe('Acme');
  });

  it('evaluates a formula output against declared inputs', () => {
    expect(
      runProgram(
        { output: 'concat({{first}}, " ", {{last}})' },
        { first: 'Ada', last: 'Lovelace' },
      ),
    ).toBe('Ada Lovelace');
  });

  it('resolves declared inputs inside program nodes', () => {
    expect(
      runProgram(
        {
          nodes: [
            {
              id: 'trim',
              type: 'formula',
              config: { expression: 'trim({{inputs.name}})' },
            },
          ],
          output: '{{trim.output}}',
        },
        { name: '  Acme  ' },
      ),
    ).toBe('Acme');
  });
});
