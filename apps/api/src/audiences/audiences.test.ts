import { describe, expect, it } from 'vitest';
import { readMappedValue } from './audiences.controller';

describe('audience import mappings', () => {
  it('reads mapped fields from object-valued cells without stringifying objects', () => {
    expect(readMappedValue({ email: 'person@example.com' }, 'email')).toBe('person@example.com');
    expect(readMappedValue({ domain: 'example.com' }, 'domain')).toBe('example.com');
    expect(readMappedValue({ email: 'person@example.com' }, 'domain')).toBeUndefined();
  });
});
