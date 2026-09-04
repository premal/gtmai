import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient, Prisma } from '@gtmai/db';
import { runProviderAction, type Values } from './executors';
import { runWorkflow } from './workflows';

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const workflowQueue = new Queue('workflows', { connection: redis });

async function pollSignal(job: Job<{ definitionId: string; workspaceId: string }>) {
  const definition = await db.signalDefinition.findFirst({
    where: { id: job.data.definitionId, workspaceId: job.data.workspaceId },
  });
  if (!definition) throw new Error('Signal definition not found');
  const [contacts, companies] = await Promise.all([
    db.contact.findMany({ where: { workspaceId: job.data.workspaceId }, take: 1000 }),
    db.company.findMany({ where: { workspaceId: job.data.workspaceId }, take: 1000 }),
  ]);
  const action = definition.type === 'funding' ? 'mock.funding' : 'mock.jobChanges';
  let created = 0;
  for (const contact of contacts) {
    const current = await runProviderAction(
      'mock',
      action,
      { email: contact.email, firstName: contact.firstName, lastName: contact.lastName },
      job.data.workspaceId,
    );
    if (!current.result.found) continue;
    const event = await db.signalEvent.create({
      data: {
        definitionId: definition.id,
        contactId: contact.id,
        payload: current.result.data as Prisma.InputJsonValue,
        occurredAt: new Date(),
      },
    });
    if (definition.triggerWorkflowId) {
      const run = await db.workflowRun.create({
        data: {
          workflowId: definition.triggerWorkflowId,
          input: { eventId: event.id, contactId: contact.id },
        },
      });
      await workflowQueue.add('run', { runId: run.id, workspaceId: job.data.workspaceId });
    }
    created++;
  }
  for (const company of companies) {
    const current = await runProviderAction(
      'mock',
      action,
      { domain: company.domain, company: company.name },
      job.data.workspaceId,
    );
    if (!current.result.found) continue;
    const event = await db.signalEvent.create({
      data: {
        definitionId: definition.id,
        companyId: company.id,
        payload: current.result.data as Prisma.InputJsonValue,
        occurredAt: new Date(),
      },
    });
    if (definition.triggerWorkflowId) {
      const run = await db.workflowRun.create({
        data: {
          workflowId: definition.triggerWorkflowId,
          input: { eventId: event.id, companyId: company.id },
        },
      });
      await workflowQueue.add('run', { runId: run.id, workspaceId: job.data.workspaceId });
    }
    created++;
  }
  return { created };
}

export function startPhase2Workers() {
  const signalWorker = new Worker('signals', pollSignal, { connection: redis, concurrency: 2 });
  const workflowWorker = new Worker('workflows', runWorkflow, {
    connection: redis,
    concurrency: 4,
  });
  return { signalWorker, workflowWorker };
}
