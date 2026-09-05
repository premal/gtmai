import { createHash } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { PrismaClient } from '@gtmai/db';
import { decryptCredentials } from './executors';

const db = new PrismaClient();
const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};
export type AdSyncJob = { audienceId: string; platform: string; workspaceId: string };
type ContactRecord = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};
export type AdPlatformAdapter = {
  id: string;
  hashRecords: (contacts: ContactRecord[]) => Array<Record<string, string>>;
  upload: (
    records: Array<Record<string, string>>,
    credentials?: Record<string, string>,
    options?: { externalId?: string; audienceName?: string },
  ) => Promise<string>;
};
function hash(value: string) {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}
export const hashAdRecords = (contacts: ContactRecord[]) =>
  contacts.map((contact) => ({
    ...(contact.email ? { email: hash(contact.email) } : {}),
    ...(contact.phone ? { phone: hash(contact.phone) } : {}),
  }));
export const metaAdapter: AdPlatformAdapter = {
  id: 'meta',
  hashRecords: hashAdRecords,
  upload: uploadMetaAudience,
};
const adapters: Record<string, AdPlatformAdapter> = {
  mock: { id: 'mock', hashRecords: hashAdRecords, upload: async () => `mock-${Date.now()}` },
  meta: metaAdapter,
  google: {
    id: 'google',
    hashRecords: hashAdRecords,
    upload: async () => {
      throw new Error('google sync not yet supported — connection accepted, upload pending');
    },
  },
  linkedin: {
    id: 'linkedin',
    hashRecords: hashAdRecords,
    upload: async () => {
      throw new Error('linkedin sync not yet supported — connection accepted, upload pending');
    },
  },
};

async function readMetaResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const error = body.error as Record<string, unknown> | undefined;
    throw new Error(
      String(error?.message ?? body.message ?? `Meta API request failed (${response.status})`),
    );
  }
  return body;
}

async function uploadMetaAudience(
  records: Array<Record<string, string>>,
  credentials?: Record<string, string>,
  options?: { externalId?: string; audienceName?: string },
): Promise<string> {
  const accessToken = credentials?.accessToken;
  const adAccountId = credentials?.adAccountId;
  if (!accessToken || !adAccountId) {
    throw new Error('Meta credentials require accessToken and adAccountId');
  }
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  let audienceId = options?.externalId;
  if (!audienceId) {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/act_${encodeURIComponent(adAccountId)}/customaudiences`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: options?.audienceName ?? 'GTM AI audience',
          subtype: 'CUSTOMER_FILE_SOURCE',
          customer_file_source: 'USER_PROVIDED_ONLY',
        }),
      },
    );
    const body = await readMetaResponse(response);
    audienceId = typeof body.id === 'string' ? body.id : undefined;
    if (!audienceId) throw new Error('Meta API did not return a custom audience id');
  }
  for (let index = 0; index < records.length; index += 1000) {
    const batch = records.slice(index, index + 1000);
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(audienceId)}/users`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            payload: {
              schema: ['EMAIL', 'PHONE'],
              data: batch.map((record) => [record.email ?? '', record.phone ?? '']),
            },
          }),
        },
      );
      await readMetaResponse(response);
    } catch (error) {
      const enrichedError = error instanceof Error ? error : new Error(String(error));
      Object.assign(enrichedError, {
        externalId: audienceId,
      });
      throw enrichedError;
    }
  }
  return audienceId;
}

export async function executeAdSync(job: Job<AdSyncJob>) {
  const audience = await db.adAudience.findFirst({
    where: { id: job.data.audienceId, workspaceId: job.data.workspaceId },
  });
  if (!audience) throw new Error('Ad audience not found');
  const adapter = adapters[job.data.platform];
  if (!adapter) throw new Error(`Unsupported ad platform ${job.data.platform}`);
  const segmentId =
    audience.segmentId ?? String((audience.config as Record<string, unknown>).segmentId ?? '');
  const memberships = segmentId
    ? await db.segmentMembership.findMany({
        where: { segmentId, segment: { workspaceId: job.data.workspaceId } },
        include: { contact: true },
      })
    : [];
  const records = adapter.hashRecords(memberships.map((item) => item.contact));
  const existingSync = await db.adPlatformSync.findUnique({
    where: { audienceId_platform: { audienceId: audience.id, platform: job.data.platform } },
  });
  let credentials: Record<string, string> | undefined;
  try {
    if (job.data.platform !== 'mock') {
      const connectionRow = await db.connection.findFirst({
        where: { workspaceId: job.data.workspaceId, provider: job.data.platform },
      });
      if (!connectionRow) throw new Error(`No connection for ${job.data.platform}`);
      credentials = decryptCredentials(connectionRow.encryptedCredentials);
    }
    const externalId = await adapter.upload(
      records,
      credentials,
      existingSync?.externalId
        ? { externalId: existingSync.externalId, audienceName: audience.name }
        : { audienceName: audience.name },
    );
    await db.adPlatformSync.upsert({
      where: { audienceId_platform: { audienceId: audience.id, platform: job.data.platform } },
      update: {
        status: 'synced',
        externalId,
        matched: records.length,
        uploaded: records.length,
        syncedAt: new Date(),
        error: null,
      },
      create: {
        audienceId: audience.id,
        platform: job.data.platform,
        status: 'synced',
        externalId,
        matched: records.length,
        uploaded: records.length,
        syncedAt: new Date(),
      },
    });
    return { matched: records.length, uploaded: records.length, externalId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ad sync failed';
    const errorExternalId =
      error instanceof Error && 'externalId' in error
        ? String((error as Error & { externalId?: string }).externalId)
        : null;
    await db.adPlatformSync.upsert({
      where: { audienceId_platform: { audienceId: audience.id, platform: job.data.platform } },
      update: {
        status: 'failed',
        error: message,
        matched: records.length,
        uploaded: 0,
        externalId: existingSync?.externalId ?? errorExternalId,
      },
      create: {
        audienceId: audience.id,
        platform: job.data.platform,
        status: 'failed',
        error: message,
        matched: records.length,
        uploaded: 0,
      },
    });
    throw new Error(message);
  }
}

export function startAdsWorker() {
  return new Worker<AdSyncJob>('ads', executeAdSync, { connection, concurrency: 4 });
}
