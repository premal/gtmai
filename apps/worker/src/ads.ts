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
const adapters: Record<string, AdPlatformAdapter> = {
  mock: { id: 'mock', hashRecords: hashAdRecords, upload: async () => `mock-${Date.now()}` },
  meta: {
    id: 'meta',
    hashRecords: hashAdRecords,
    upload: async (_records, credentials) => `meta-${credentials?.accountId ?? 'audience'}`,
  },
  google: {
    id: 'google',
    hashRecords: hashAdRecords,
    upload: async (_records, credentials) => `google-${credentials?.customerId ?? 'audience'}`,
  },
  linkedin: {
    id: 'linkedin',
    hashRecords: hashAdRecords,
    upload: async (_records, credentials) => `linkedin-${credentials?.accountId ?? 'audience'}`,
  },
};

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
  let credentials: Record<string, string> | undefined;
  try {
    if (job.data.platform !== 'mock') {
      const connectionRow = await db.connection.findFirst({
        where: { workspaceId: job.data.workspaceId, provider: job.data.platform },
      });
      if (!connectionRow) throw new Error(`No connection for ${job.data.platform}`);
      credentials = decryptCredentials(connectionRow.encryptedCredentials);
    }
    const externalId = await adapter.upload(records, credentials);
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
    await db.adPlatformSync.updateMany({
      where: { audienceId: audience.id, platform: job.data.platform },
      data: { status: 'failed', error: message },
    });
    throw new Error(message);
  }
}

export function startAdsWorker() {
  return new Worker<AdSyncJob>('ads', executeAdSync, { connection, concurrency: 4 });
}
