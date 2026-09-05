import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hashAdRecords, metaAdapter } from './ads';
describe('ad audience hashing', () => {
  it('hashes email and phone with normalized sha256 values', () => {
    expect(hashAdRecords([{ email: ' Ada@example.com ' }])[0]?.email).toBe(
      createHash('sha256').update('ada@example.com').digest('hex'),
    );
  });

  it('creates a Meta audience once and uploads users in batches', async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = String(input);
      return new Response(
        url.includes('/customaudiences')
          ? JSON.stringify({ id: 'meta-audience-1' })
          : JSON.stringify({ audience_id: 'meta-audience-1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const records = hashAdRecords(
      Array.from({ length: 1001 }, (_, index) => ({
        email: `person-${index}@example.com`,
        phone: `+1555000${index}`,
      })),
    );

    await expect(
      metaAdapter.upload(
        records,
        { accessToken: 'token', adAccountId: '123' },
        { audienceName: 'Demo audience' },
      ),
    ).resolves.toBe('meta-audience-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://graph.facebook.com/v19.0/act_123/customaudiences',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      name: 'Demo audience',
      subtype: 'CUSTOMER_FILE_SOURCE',
      customer_file_source: 'USER_PROVIDED_ONLY',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).payload).toMatchObject({
      schema: ['EMAIL', 'PHONE'],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).payload.data).toHaveLength(1000);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).payload.data).toHaveLength(1);

    fetchMock.mockClear();
    await metaAdapter.upload(
      records.slice(0, 1),
      { accessToken: 'token', adAccountId: '123' },
      {
        externalId: 'meta-audience-1',
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/meta-audience-1/users');
    vi.unstubAllGlobals();
  });
});
