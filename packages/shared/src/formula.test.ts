import { describe, expect, it } from 'vitest';
import { evaluateFormula } from './formula';
import { resolveBindings } from './bindings';
describe('formula',()=>{it('evaluates safe expressions',()=>expect(evaluateFormula('if(contains(lower({{Email}}), "@acme"), upper({{Name}}), "none")',{Email:'A@ACME.com',Name:'ada'})).toBe('ADA'));it('supports arithmetic',()=>expect(evaluateFormula('({{A}} * 2) + 1',{A:4})).toBe(9))});
describe('bindings',()=>it('resolves templates',()=>expect(resolveBindings('Hello {{Name}}',{Name:'Ada'})).toBe('Hello Ada')));
