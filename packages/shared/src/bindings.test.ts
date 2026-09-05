import { describe, expect, it } from 'vitest';
import { getPath, resolveBindings, resolveBindingsDeep } from './bindings';

describe('binding paths', () => {
  it('resolves dotted paths through nested workflow data', () => {
    const value = { trigger: { email: 'ada@example.com' }, node: { output: { score: 42 } } };
    expect(getPath(value, 'node.output.score')).toBe(42);
    expect(resolveBindings('{{trigger.email}} / {{node.output.score}}', value)).toBe(
      'ada@example.com / 42',
    );
  });

  it('resolves nested objects and arrays while preserving exact binding types', () => {
    const value = {
      enrich: { output: { confidence: 0.92, name: 'Ada' } },
      trigger: { tags: ['lead', 'signal'] },
    };
    expect(
      resolveBindingsDeep(
        {
          values: {
            score: '{{enrich.output.confidence}}',
            label: 'Contact: {{enrich.output.name}}',
          },
          tags: ['{{trigger.tags}}', '{{enrich.output.name}}'],
        },
        value,
      ),
    ).toEqual({
      values: { score: 0.92, label: 'Contact: Ada' },
      tags: [['lead', 'signal'], 'Ada'],
    });
  });
});
