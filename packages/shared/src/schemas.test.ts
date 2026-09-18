import { describe, expect, it } from 'vitest';
import { generatedSequence, metapromptResult, signalConfig, waterfallConfig } from './schemas';

describe('schemas', () => {
  it('parses a waterfall config with a validation step and max cost', () => {
    const parsed = waterfallConfig.parse({
      providers: [{ provider: 'mock', action: 'mock.findEmail' }],
      accept: 'found',
      validate: { provider: 'mock', action: 'mock.verifyEmail' },
      maxCost: 10,
    });
    expect(parsed.validate?.action).toBe('mock.verifyEmail');
    expect(parsed.maxCost).toBe(10);
  });

  it('keeps waterfall validation optional', () => {
    const parsed = waterfallConfig.parse({
      providers: [{ provider: 'mock', action: 'mock.findEmail' }],
    });
    expect(parsed.accept).toBe('found');
    expect(parsed.validate).toBeUndefined();
    expect(parsed.maxCost).toBeUndefined();
  });

  it('parses metaprompt results with a default type', () => {
    const parsed = metapromptResult.parse({
      name: 'B2B check',
      kind: 'agent',
      config: { prompt: 'Visit {{Domain}}', outputFields: { isB2B: 'boolean', answer: 'string' } },
    });
    expect(parsed.type).toBe('text');
    expect(parsed.runCondition).toBeUndefined();
  });

  it('validates signal schedules and keeps extra keys', () => {
    const parsed = signalConfig.parse({
      provider: 'mock',
      schedule: 'weekly',
      sourceTableId: 'tbl_1',
      alertChannelId: 'chan_1',
      customNote: 'keep me',
    });
    expect(parsed.schedule).toBe('weekly');
    expect((parsed as Record<string, unknown>).customNote).toBe('keep me');
    expect(() => signalConfig.parse({ schedule: 'yearly' })).toThrow();
  });

  it('defaults generated sequence delay hours', () => {
    const parsed = generatedSequence.parse({
      steps: [{ subjectTemplate: 'Hi {{contact.firstName}}', bodyTemplate: 'Hello' }],
    });
    expect(parsed.steps[0]?.delayHours).toBe(0);
    expect(() => generatedSequence.parse({ steps: [] })).toThrow();
  });
});
