import { createDecipheriv } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient, Prisma } from '@gtmai/db';
import { providers } from '@gtmai/providers';
import {
  evaluateFormula,
  getPath,
  resolveBindings,
  topologicalOrder,
  type WorkflowGraph,
} from '@gtmai/shared';

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const workflowQueue = new Queue('workflows', { connection: redis });
type Values = Record<string, unknown>;

function decrypt(value: string): Record<string, string> {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes in hex');
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
  ) as Record<string, string>;
}

async function runProvider(
  providerId: string,
  actionId: string,
  input: Values,
  workspaceId: string,
) {
  const provider = providers.find((item) => item.id === providerId);
  const action = provider?.actions.find((item) => item.id === actionId);
  if (!provider || !action) throw new Error(`Provider action not found: ${providerId}/${actionId}`);
  const connection = await db.connection.findFirst({
    where: { workspaceId, provider: providerId },
  });
  if (!connection) throw new Error(`No connection for ${providerId}`);
  return {
    action,
    provider: providerId,
    result: await action.run(input, {
      credentials: decrypt(connection.encryptedCredentials),
      fetch,
      logger: { info: () => undefined, error: () => undefined },
    }),
  };
}

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
    const current = await runProvider(
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
    const current = await runProvider(
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

function bind(value: unknown, context: Values): unknown {
  if (typeof value !== 'string') return value;
  return resolveBindings(value, context);
}

async function runWorkflow(job: Job<{ runId: string; workspaceId: string }>) {
  const run = await db.workflowRun.findUnique({
    where: { id: job.data.runId },
    include: { workflow: true },
  });
  if (!run) throw new Error('Workflow run not found');
  const graph = run.workflow.graph as unknown as WorkflowGraph;
  const order = topologicalOrder(graph);
  const outputs: Values = { trigger: run.input ?? {} };
  await db.workflowRun.update({
    where: { id: run.id },
    data: { status: 'running', startedAt: new Date() },
  });
  try {
    for (const nodeId of order) {
      const node = graph.nodes.find((item) => item.id === nodeId)!;
      const input = Object.fromEntries(
        Object.entries(node.config).map(([key, value]) => [key, bind(value, outputs)]),
      );
      const step = await db.stepRun.create({
        data: {
          workflowRunId: run.id,
          nodeId,
          status: 'running',
          input: input as Prisma.InputJsonValue,
        },
      });
      let output: unknown = input;
      if (node.type === 'enrich' || node.type === 'waterfall') {
        const providerId = String(input.provider ?? (node.config.provider as string) ?? 'mock');
        const actionId = String(
          input.action ?? (node.config.action as string) ?? 'mock.enrichPerson',
        );
        const current = await runProvider(providerId, actionId, input, job.data.workspaceId);
        output = current.result.found ? current.result.data : {};
      } else if (node.type === 'formula') {
        output = evaluateFormula(String(input.expression ?? ''), outputs);
      } else if (node.type === 'condition') {
        output = { value: evaluateFormula(String(input.expression ?? ''), outputs) };
      } else if (node.type === 'function') {
        const functionId = String(input.functionId ?? '');
        const versionNumber = typeof input.version === 'number' ? input.version : undefined;
        const version = await db.functionVersion.findFirst({
          where: { functionId, ...(versionNumber ? { version: versionNumber } : {}) },
          orderBy: { version: 'desc' },
        });
        if (!version) throw new Error('Function version not found');
        const program = version.program as { output?: string };
        const functionInput = (input.input ?? {}) as Values;
        output =
          typeof program.output === 'string'
            ? resolveBindings(program.output, functionInput)
            : functionInput;
      } else if (node.type === 'audience.upsert') {
        const email = typeof input.email === 'string' ? input.email.toLowerCase() : undefined;
        if (email) {
          const contact = await db.contact.upsert({
            where: { workspaceId_emailKey: { workspaceId: job.data.workspaceId, emailKey: email } },
            update: { data: input.data as Prisma.InputJsonValue },
            create: {
              workspace: { connect: { id: job.data.workspaceId } },
              email,
              emailKey: email,
              data: input.data as Prisma.InputJsonValue,
            },
          });
          output = { contactId: contact.id };
        }
      } else if (node.type === 'table.appendRow') {
        const tableId = String(input.tableId);
        const table = await db.table.findFirst({
          where: { id: tableId, workspaceId: job.data.workspaceId },
          include: { columns: true },
        });
        if (table) {
          const row = await db.row.create({
            data: { tableId, position: await db.row.count({ where: { tableId } }) },
          });
          await db.cell.createMany({
            data: table.columns.map((column) => ({
              rowId: row.id,
              columnId: column.id,
              value: (getPath(input, column.name) ?? null) as object,
              status: 'done',
            })),
          });
          output = { rowId: row.id };
        }
      } else if (node.type === 'delay') {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(Number(input.ms ?? 0), 10_000)),
        );
      } else if (node.type === 'webhook.out') {
        await fetch(String(input.url ?? ''), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.body ?? outputs),
        });
      }
      outputs[node.id] = output as Values;
      await db.stepRun.update({
        where: { id: step.id },
        data: { status: 'done', output: output as object },
      });
      await publisher.publish(
        `workflow:${run.id}`,
        JSON.stringify({ nodeId, status: 'done', output }),
      );
    }
    await db.workflowRun.update({
      where: { id: run.id },
      data: { status: 'done', output: outputs as Prisma.InputJsonValue, completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow failed';
    await db.workflowRun.update({
      where: { id: run.id },
      data: { status: 'error', output: { error: message }, completedAt: new Date() },
    });
    await publisher.publish(
      `workflow:${run.id}`,
      JSON.stringify({ status: 'error', error: message }),
    );
    throw error;
  }
}

export function startPhase2Workers() {
  const signalWorker = new Worker('signals', pollSignal, { connection: redis, concurrency: 2 });
  const workflowWorker = new Worker('workflows', runWorkflow, {
    connection: redis,
    concurrency: 4,
  });
  return { signalWorker, workflowWorker };
}
