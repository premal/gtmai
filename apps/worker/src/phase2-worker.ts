import { createHash } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient, Prisma } from '@gtmai/db';
import { runProviderAction, type Values } from './executors';
import { runWorkflow } from './workflows';
import { startOutboundWorker } from './outbound';
import { startAdsWorker } from './ads';
import { startCrmWorker } from './crm';
import { startUsageWorker } from './usage';

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const workflowQueue = new Queue('workflows', { connection: redis });

function resultDedupeKey(
  scope: 'contact' | 'company',
  entityId: string,
  result: { raw?: unknown },
  payload: unknown,
) {
  const raw = result.raw as { seed?: unknown } | undefined;
  const payloadHash =
    typeof raw?.seed === 'string'
      ? raw.seed
      : createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `${scope}:${entityId}:${payloadHash}`;
}

type SignalTarget = {
  scope: 'contact' | 'company';
  entityId: string;
  input: Values;
  contactId?: string;
  companyId?: string;
};

async function tableSignalTargets(
  tableId: string,
  config: Record<string, unknown>,
): Promise<SignalTarget[]> {
  const columns = await db.column.findMany({ where: { tableId } });
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (configured: unknown, aliases: string[]): string | undefined => {
    if (typeof configured === 'string' && configured) {
      const named = columns.find((column) => column.name === configured);
      if (named) return named.name;
    }
    return columns.find((column) => aliases.includes(normalize(column.name)))?.name;
  };
  const domainColumn = pick(config.domainColumn, [
    'domain',
    'website',
    'companydomain',
    'webdomain',
  ]);
  const emailColumn = pick(config.emailColumn, ['email', 'workemail', 'emailaddress']);
  const companyColumn = pick(undefined, ['company', 'companyname', 'account', 'accountname']);
  const firstColumn = pick(undefined, ['firstname', 'first', 'givenname']);
  const lastColumn = pick(undefined, ['lastname', 'last', 'familyname', 'surname']);
  if (!domainColumn && !emailColumn) return [];
  const rows = await db.row.findMany({
    where: { tableId },
    include: { cells: { include: { column: true } } },
    orderBy: { position: 'asc' },
    take: 1000,
  });
  const seen = new Set<string>();
  const targets: SignalTarget[] = [];
  for (const row of rows) {
    const values = Object.fromEntries(row.cells.map((cell) => [cell.column.name, cell.value]));
    const domain = domainColumn
      ? String(values[domainColumn] ?? '')
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, '')
      : '';
    const email = emailColumn ? String(values[emailColumn] ?? '').trim() : '';
    if (domain) {
      const key = `d:${domain.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          scope: 'company',
          entityId: domain.toLowerCase(),
          input: {
            domain,
            company: companyColumn ? String(values[companyColumn] ?? '') : '',
          },
        });
      }
    }
    if (email) {
      const key = `e:${email.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          scope: 'contact',
          entityId: email.toLowerCase(),
          input: {
            email,
            firstName: firstColumn ? String(values[firstColumn] ?? '') : '',
            lastName: lastColumn ? String(values[lastColumn] ?? '') : '',
          },
        });
      }
    }
  }
  return targets;
}

async function pollSignal(job: Job<{ definitionId: string; workspaceId: string }>) {
  const definition = await db.signalDefinition.findFirst({
    where: { id: job.data.definitionId, workspaceId: job.data.workspaceId },
  });
  if (!definition) throw new Error('Signal definition not found');
  const config = (definition.config ?? {}) as Record<string, unknown>;
  const provider = typeof config.provider === 'string' ? config.provider : 'mock';
  const action =
    typeof config.action === 'string' && config.action
      ? config.action
      : definition.type === 'funding'
        ? 'mock.funding'
        : 'mock.jobChanges';
  let targets: SignalTarget[];
  if (typeof config.sourceTableId === 'string' && config.sourceTableId) {
    targets = await tableSignalTargets(config.sourceTableId, config);
  } else {
    const [contacts, companies] = await Promise.all([
      db.contact.findMany({ where: { workspaceId: job.data.workspaceId }, take: 1000 }),
      db.company.findMany({ where: { workspaceId: job.data.workspaceId }, take: 1000 }),
    ]);
    targets = [
      ...contacts.map(
        (contact): SignalTarget => ({
          scope: 'contact',
          entityId: contact.id,
          contactId: contact.id,
          input: {
            email: contact.email,
            firstName: contact.firstName,
            lastName: contact.lastName,
          },
        }),
      ),
      ...companies.map(
        (company): SignalTarget => ({
          scope: 'company',
          entityId: company.id,
          companyId: company.id,
          input: { domain: company.domain, company: company.name },
        }),
      ),
    ];
  }
  const createdEvents: {
    id: string;
    contactId: string | null;
    companyId: string | null;
    payload: unknown;
    occurredAt: Date;
  }[] = [];
  for (const target of targets) {
    const current = await runProviderAction(provider, action, target.input, job.data.workspaceId);
    if (!current.result.found) continue;
    const dedupeKey = resultDedupeKey(
      target.scope,
      target.entityId,
      current.result,
      current.result.data,
    );
    const existing = await db.signalEvent.findUnique({
      where: { definitionId_dedupeKey: { definitionId: definition.id, dedupeKey } },
    });
    if (existing) continue;
    let { contactId, companyId } = target;
    if (!contactId && typeof target.input.email === 'string' && target.input.email) {
      contactId = (
        await db.contact.findFirst({
          where: {
            workspaceId: job.data.workspaceId,
            OR: [
              { emailKey: target.input.email.toLowerCase() },
              { email: { equals: target.input.email, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        })
      )?.id;
    }
    if (!companyId && typeof target.input.domain === 'string' && target.input.domain) {
      companyId = (
        await db.company.findFirst({
          where: {
            workspaceId: job.data.workspaceId,
            domainKey: target.input.domain.toLowerCase(),
          },
          select: { id: true },
        })
      )?.id;
    }
    const event = await db.signalEvent.create({
      data: {
        definitionId: definition.id,
        dedupeKey,
        ...(contactId ? { contactId } : {}),
        ...(companyId ? { companyId } : {}),
        payload: current.result.data as Prisma.InputJsonValue,
        occurredAt: new Date(),
      },
    });
    if (definition.triggerWorkflowId) {
      const run = await db.workflowRun.create({
        data: {
          workflowId: definition.triggerWorkflowId,
          input: {
            eventId: event.id,
            ...(contactId ? { contactId } : {}),
            ...(companyId ? { companyId } : {}),
          },
        },
      });
      await workflowQueue.add('run', { runId: run.id, workspaceId: job.data.workspaceId });
    }
    createdEvents.push(event);
  }
  if (createdEvents.length > 0) {
    const summary = `${definition.name}: ${createdEvents.length} new ${definition.type} event${
      createdEvents.length === 1 ? '' : 's'
    }`;
    await db.alert.create({
      data: {
        workspaceId: job.data.workspaceId,
        type: 'signal',
        severity: 'info',
        message: summary,
        metadata: {
          definitionId: definition.id,
          eventIds: createdEvents.map((event) => event.id),
        },
      },
    });
    const channelId = typeof config.alertChannelId === 'string' ? config.alertChannelId : '';
    if (channelId) {
      const channel = await db.alertChannel.findFirst({
        where: { id: channelId, workspaceId: job.data.workspaceId, enabled: true },
      });
      if (channel) {
        try {
          await fetch(channel.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: summary,
              definition: { id: definition.id, name: definition.name, type: definition.type },
              events: createdEvents.map((event) => ({
                id: event.id,
                contactId: event.contactId,
                companyId: event.companyId,
                payload: event.payload,
                occurredAt: event.occurredAt,
              })),
            }),
          });
        } catch {
          // Alert delivery must not fail the poll.
        }
      }
    }
  }
  return { created: createdEvents.length };
}

export function startPhase2Workers() {
  const signalWorker = new Worker('signals', pollSignal, { connection: redis, concurrency: 2 });
  const workflowWorker = new Worker('workflows', runWorkflow, {
    connection: redis,
    concurrency: 4,
  });
  const outboundWorker = startOutboundWorker();
  const adsWorker = startAdsWorker();
  const crmWorker = startCrmWorker();
  const usageWorker = startUsageWorker();
  return { signalWorker, workflowWorker, outboundWorker, adsWorker, crmWorker, usageWorker };
}
