import { describe, expect, it } from 'vitest';
import { nextStepDelayMs } from './outbound';
describe('outbound scheduling', () => {
  it('converts step delay hours into BullMQ milliseconds', () => {
    expect(nextStepDelayMs(24)).toBe(24 * 3_600_000);
  });
});
