import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashAdRecords } from './ads';
describe('ad audience hashing', () => {
  it('hashes email and phone with normalized sha256 values', () => {
    expect(hashAdRecords([{ email: ' Ada@example.com ' }])[0]?.email).toBe(
      createHash('sha256').update('ada@example.com').digest('hex'),
    );
  });
});
