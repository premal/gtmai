import { Worker, type Job } from 'bullmq';
import { PrismaClient } from '@gtmai/db';
import { decryptCredentials } from './executors';
const json = (value: unknown) => value as import('@gtmai/db').Prisma.InputJsonValue;

const db = new PrismaClient();
const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};
export type CrmRunJob = { jobId: string; workspaceId: string };
type Config = {
  provider: string;
  object: 'contact' | 'company';
  fieldMapping: Record<string, string>;
  upsertKey: string;
};
function valueAt(source: Record<string, unknown>, path: string) {
  return path
    .split('.')
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[part]
          : undefined,
      source,
    );
}
export function mapCrmRecord(source: Record<string, unknown>, config: Config) {
  return Object.fromEntries(
    Object.entries(config.fieldMapping).map(([destination, sourceField]) => [
      destination,
      valueAt(source, sourceField),
    ]),
  );
}

async function executeCrmRunInternal(job: Job<CrmRunJob>) {
  const syncJob = await db.crmSyncJob.findFirst({
    where: { id: job.data.jobId, workspaceId: job.data.workspaceId },
  });
  if (!syncJob) throw new Error('CRM sync job not found');
  const source = syncJob.source as { kind: 'segment' | 'table'; id: string };
  const destination = syncJob.destination as Config;
  let sources: Array<Record<string, unknown>> = [];
  if (source.kind === 'segment') {
    const memberships = await db.segmentMembership.findMany({
      where: { segmentId: source.id, segment: { workspaceId: job.data.workspaceId } },
      include: { contact: { include: { company: true } } },
    });
    sources = memberships.map(({ contact }) => ({ ...contact, company: contact.company }));
    if (destination.object === 'company') {
      const seen = new Set<string>();
      sources = sources
        .filter((item) => {
          const key = String(
            (item.company as Record<string, unknown> | null)?.domain ?? item.companyId ?? '',
          );
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((item) => (item.company ?? {}) as Record<string, unknown>);
    }
  } else {
    const table = await db.table.findFirst({
      where: { id: source.id, workspaceId: job.data.workspaceId },
      include: { columns: true, rows: { include: { cells: true } } },
    });
    if (!table) throw new Error('Source table not found');
    sources = table.rows.map((row) =>
      Object.fromEntries(
        table.columns.map((column) => [
          column.name,
          row.cells.find((cell) => cell.columnId === column.id)?.value,
        ]),
      ),
    );
  }
  const mapped = sources
    .map((item) => mapCrmRecord(item, destination))
    .filter((item) => valueAt(item, destination.upsertKey) !== undefined);
  let credentials: Record<string, string> | undefined;
  if (destination.provider !== 'mock') {
    const connectionRow = await db.connection.findFirst({
      where: { workspaceId: job.data.workspaceId, provider: destination.provider },
    });
    if (!connectionRow) throw new Error(`No connection for ${destination.provider}`);
    credentials = decryptCredentials(connectionRow.encryptedCredentials);
  }
  if (destination.provider === 'webhook') {
    const url = credentials?.url;
    if (!url) throw new Error('Webhook connection requires url');
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mapped),
    });
  } else if (destination.provider === 'hubspot') {
    const token = credentials?.accessToken ?? credentials?.token;
    if (!token) throw new Error('HubSpot connection requires accessToken');
    await fetch(`https://api.hubapi.com/crm/v3/objects/${destination.object}/batch/upsert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        inputs: mapped.map((properties) => ({
          id: String(valueAt(properties, destination.upsertKey)),
          idProperty: destination.upsertKey,
          properties,
        })),
      }),
    });
  } else if (destination.provider !== 'mock') {
    throw new Error(`Unsupported CRM provider ${destination.provider}`);
  }
  for (const record of mapped) {
    const externalKey = String(valueAt(record, destination.upsertKey));
    await db.crmSyncRecord.upsert({
      where: { jobId_externalKey: { jobId: syncJob.id, externalKey } },
      update: { data: json(record), syncedAt: new Date() },
      create: {
        workspaceId: job.data.workspaceId,
        jobId: syncJob.id,
        externalKey,
        data: json(record),
      },
    });
  }
  const stats = {
    matched: sources.length,
    synced: mapped.length,
    skipped: sources.length - mapped.length,
  };
  await db.crmSyncJob.update({
    where: { id: syncJob.id },
    data: { lastRunAt: new Date(), lastStats: stats },
  });
  return stats;
}
export async function executeCrmRun(job: Job<CrmRunJob>) {
  const run = await db.crmSyncRun.create({
    data: { jobId: job.data.jobId, status: 'running', startedAt: new Date() },
  });
  try {
    const stats = await executeCrmRunInternal(job);
    await db.crmSyncRun.update({
      where: { id: run.id },
      data: { status: 'completed', stats: json(stats), completedAt: new Date() },
    });
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM sync failed';
    await db.crmSyncRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: message, completedAt: new Date() },
    });
    throw error;
  }
}
export function startCrmWorker() {
  return new Worker<CrmRunJob>('crm', executeCrmRun, { connection, concurrency: 2 });
}
