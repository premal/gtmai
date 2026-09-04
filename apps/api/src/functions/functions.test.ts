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
});
