import { describe, expect, it } from 'vitest';
import { evaluateFormula } from './formula';
import { resolveBindings } from './bindings';

describe('formula', () => {
  it('evaluates safe expressions', () => {
    expect(
      evaluateFormula('if(contains(lower({{Email}}), "@acme"), upper({{Name}}), "none")', {
        Email: 'A@ACME.com',
        Name: 'ada',
      }),
    ).toBe('ADA');
  });

  it('supports arithmetic precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
  });

  it('supports string concatenation and if', () => {
    expect(evaluateFormula('concat("Ada", " ", "Lovelace")', {})).toBe('Ada Lovelace');
    expect(evaluateFormula('if({{Score}} > 5, "yes", "no")', { Score: 6 })).toBe('yes');
  });

  it('rejects unknown functions', () => {
    expect(() => evaluateFormula('unknown("value")', {})).toThrow(/Unknown function/);
  });

  it('supports column references containing spaces', () => {
    expect(evaluateFormula('upper({{First name}})', { 'First name': 'ada' })).toBe('ADA');
  });
});

describe('bindings', () => {
  it('resolves templates', () => {
    expect(resolveBindings('Hello {{ Name }}', { Name: 'Ada' })).toBe('Hello Ada');
  });
});
