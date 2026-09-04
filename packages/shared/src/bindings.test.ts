import { describe, expect, it } from 'vitest';
import { getPath, resolveBindings } from './bindings';

describe('binding paths', () => {
  it('resolves dotted paths through nested workflow data', () => {
    const value = { trigger: { email: 'ada@example.com' }, node: { output: { score: 42 } } };
    expect(getPath(value, 'node.output.score')).toBe(42);
    expect(resolveBindings('{{trigger.email}} / {{node.output.score}}', value)).toBe(
      'ada@example.com / 42',
    );
  });
});
