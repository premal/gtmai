import { describe, expect, it } from 'vitest';
import { mapCrmRecord } from './crm';
describe('CRM mapping', () => {
  it('maps fields and preserves upsert keys', () => {
    expect(
      mapCrmRecord(
        { email: 'a@example.com', firstName: 'Ada' },
        {
          provider: 'mock',
          object: 'contact',
          fieldMapping: { email: 'email', firstname: 'firstName' },
          upsertKey: 'email',
        },
      ),
    ).toEqual({ email: 'a@example.com', firstname: 'Ada' });
  });
});
