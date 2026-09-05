import { Queue, type Job } from 'bullmq';
import { Prisma } from '@gtmai/db';
import {
  evaluateFormula,
  getPath,
  resolveBindings,
  resolveBindingsDeep,
  topologicalOrder,
  type WorkflowGraph,
} from '@gtmai/shared';
import {
  executeAgent,
  executeEnrichment,
  executeFormula,
  executeHttp,
  executeWaterfall,
  closeExecutorResources,
  executorDb,
  type Values,
} from './executors';
import { budgetExceeded } from './budgets';

const redis = new (require('ioredis'))(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
}) as import('ioredis').default;
const publisher = new (require('ioredis'))(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
) as import('ioredis').default;
const workflowQueue = new Queue('workflows', { connection: redis });
const outboundQueue = new Queue('outbound', { connection: redis });
const json = (value: unknown) => value as Prisma.InputJsonValue;

type WorkflowJob = { runId: string; workspaceId: string; resumeFrom?: string };
type NodeState = 'done' | 'error' | 'skipped';

async function publishWorkflowEvent(
  workflowId: string,
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const message = JSON.stringify({ runId, ...payload });
  await Promise.all([
    publisher.publish(`workflow:${runId}`, message),
    publisher.publish(`workflow:${workflowId}`, message),
  ]);
}

function bindingValues(outputs: Values): Values {
  const values: Values = { ...outputs };
  for (const [nodeId, value] of Object.entries(outputs)) {
    if (!value || typeof value !== 'object') continue;
    values[`${nodeId}.output`] = (value as Values).output;
    const output = (value as Values).output;
    if (nodeId === 'trigger') {
      const trigger = (output ?? value) as Values;
      values.trigger = { ...(values.trigger as Values), ...trigger };
      for (const [key, item] of Object.entries(trigger)) {
        values[`trigger.${key}`] = item;
      }
    }
    if (output && typeof output === 'object') {
      for (const [key, item] of Object.entries(output as Values)) {
        values[`${nodeId}.output.${key}`] = item;
      }
    }
  }
  return values;
}

function bindConfig(config: Values, outputs: Values): Values {
  return resolveBindingsDeep(config, outputs);
}

function bindNodeConfig(type: string, config: Values, context: Values): Values {
  const resolved = bindConfig(config, context);
  if (type === 'condition' || type === 'formula') {
    return { ...resolved, expression: config.expression };
  }
  return resolved;
}

function evaluateCondition(expression: string, context: Values): boolean {
  const match = expression.match(/^\s*(\{\{[^}]+}})\s+contains\s+("[^"]*"|'[^']*')\s*$/i);
  if (match) {
    const actual = resolveBindings(match[1]!, context);
    const expected = match[2]!.slice(1, -1);
    return actual.includes(expected);
  }
  return Boolean(executeFormula(expression, context));
}

async function executeFunction(
  functionId: string,
  versionNumber: number | undefined,
  input: Values,
  workspaceId: string,
): Promise<{ output: unknown; credits: number }> {
  const version = await executorDb.functionVersion.findFirst({
    where: { functionId, ...(versionNumber ? { version: versionNumber } : {}) },
    orderBy: { version: 'desc' },
  });
  if (!version) throw new Error('Function version not found');
  const program = version.program as {
    inputs?: Array<{ name: string }>;
    nodes?: WorkflowGraph['nodes'];
    output?: string;
  };
  const outputs: Values = { inputs: { ...input, output: input } };
  let credits = 0;
  for (const node of program.nodes ?? []) {
    const context = bindingValues(outputs);
    const nodeConfig = bindNodeConfig(node.type, node.config, context);
    const result = await executeWorkflowNode(node.type, nodeConfig, context, workspaceId);
    outputs[node.id] = { output: result.output };
    credits += result.credits;
  }
  return {
    output:
      typeof program.output === 'string'
        ? resolveBindings(program.output, bindingValues(outputs))
        : input,
    credits,
  };
}

async function executeWorkflowNode(
  type: string,
  config: Values,
  context: Values,
  workspaceId: string,
): Promise<{ output: unknown; credits: number }> {
  if (type.startsWith('trigger.')) return { output: context.trigger ?? {}, credits: 0 };
  if (type === 'enrich') {
    const result = await executeEnrichment(config, context, workspaceId);
    if (!result.result.found) throw new Error(result.result.reason ?? 'No enrichment result');
    return { output: result.result.data, credits: result.creditsUsed };
  }
  if (type === 'waterfall') {
    const result = await executeWaterfall(config, context, workspaceId);
    if (!result.result.found) throw new Error(result.result.reason ?? 'No waterfall result');
    return { output: result.result.data, credits: result.creditsUsed };
  }
  if (type === 'agent') {
    const result = await executeAgent(config, context, workspaceId);
    if (!result.result.found) throw new Error(result.result.reason ?? 'Agent failed');
    return { output: result.result.data, credits: result.creditsUsed };
  }
  if (type === 'formula')
    return { output: executeFormula(String(config.expression ?? ''), context), credits: 0 };
  if (type === 'condition') {
    return {
      output: {
        value: evaluateCondition(String(config.expression ?? ''), context),
      },
      credits: 0,
    };
  }
  if (type === 'function') {
    const result = await executeFunction(
      String(config.functionId ?? ''),
      typeof config.version === 'number' ? config.version : undefined,
      (config.input ?? {}) as Values,
      workspaceId,
    );
    return result;
  }
  if (type === 'http') {
    const result = await executeHttp(config, context, workspaceId);
    if (!result.result.found) throw new Error(result.result.reason ?? 'HTTP request failed');
    return { output: result.result.data, credits: result.creditsUsed };
  }
  if (type === 'audience.upsert') {
    const email = typeof config.email === 'string' ? config.email.toLowerCase() : undefined;
    if (!email) return { output: {}, credits: 0 };
    const contact = await executorDb.contact.upsert({
      where: { workspaceId_emailKey: { workspaceId, emailKey: email } },
      update: { data: json(config.data ?? {}) },
      create: {
        workspace: { connect: { id: workspaceId } },
        email,
        emailKey: email,
        data: json(config.data ?? {}),
      },
    });
    return { output: { contactId: contact.id }, credits: 0 };
  }
  if (type === 'sequence.enroll') {
    const campaignId = String(config.campaignId ?? '');
    const contactId = String(config.contactId ?? getPath(context, 'trigger.contactId') ?? '');
    if (!campaignId || !contactId) throw new Error('Campaign and contact are required');
    const campaign = await executorDb.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: { sequence: { include: { steps: { orderBy: { position: 'asc' } } } } },
    });
    if (!campaign) throw new Error('Campaign not found');
    const enrollment = await executorDb.enrollment.upsert({
      where: { campaignId_contactId: { campaignId, contactId } },
      update: { status: 'active' },
      create: { campaignId, contactId, status: 'active' },
    });
    const first = campaign.sequence.steps[0];
    if (first) {
      await outboundQueue.add(
        'campaign-step',
        { enrollmentId: enrollment.id, stepPosition: first.position, workspaceId },
        { jobId: `outbound:${enrollment.id}:${first.position}` },
      );
    }
    return { output: { enrollmentId: enrollment.id }, credits: 0 };
  }
  if (type === 'table.appendRow') {
    const tableId = String(config.tableId ?? '');
    const table = await executorDb.table.findFirst({
      where: { id: tableId, workspaceId },
      include: { columns: true },
    });
    if (!table) throw new Error('Table not found');
    const row = await executorDb.row.create({
      data: { tableId, position: await executorDb.row.count({ where: { tableId } }) },
    });
    const values = (config.values ?? {}) as Values;
    for (const column of table.columns) {
      const value = values[column.name];
      const resolved = resolveBindingsDeep(value, context);
      await executorDb.cell.create({
        data:
          resolved === undefined
            ? {
                rowId: row.id,
                columnId: column.id,
                status: column.kind === 'input' ? 'done' : 'queued',
              }
            : { rowId: row.id, columnId: column.id, value: json(resolved), status: 'done' },
      });
      if (resolved === undefined && column.kind !== 'input') {
        await new Queue('cells', { connection: redis }).add('cell', {
          rowId: row.id,
          columnId: column.id,
          workspaceId,
        });
      }
    }
    return { output: { rowId: row.id }, credits: 0 };
  }
  if (type === 'webhook.out') {
    await fetch(String(config.url ?? ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config.body ?? context),
    });
    return { output: { sent: true }, credits: 0 };
  }
  if (type === 'delay') return { output: {}, credits: 0 };
  throw new Error(`Unsupported workflow node type: ${type}`);
}

export async function executeWorkflowRun(
  runId: string,
  workspaceId: string,
  resumeFrom?: string,
): Promise<void> {
  const run = await executorDb.workflowRun.findUnique({
    where: { id: runId },
    include: { workflow: true },
  });
  if (!run) throw new Error('Workflow run not found');
  const graph = run.workflow.graph as unknown as WorkflowGraph;
  const order = topologicalOrder(graph);
  const prior = (run.output ?? {}) as Values;
  const outputs: Values = (prior.__outputs as Values) ?? { trigger: run.input ?? {} };
  const states = new Map<string, NodeState>();
  let credits = run.credits;
  let terminalError = false;
  const resumeIndex = resumeFrom ? order.indexOf(resumeFrom) + 1 : 0;
  await executorDb.workflowRun.update({
    where: { id: run.id },
    data: { status: 'running', startedAt: run.startedAt ?? new Date() },
  });

  for (let index = 0; index < order.length; index++) {
    const nodeId = order[index]!;
    if (index < resumeIndex) {
      states.set(nodeId, 'done');
      continue;
    }
    const node = graph.nodes.find((item) => item.id === nodeId)!;
    const incoming = graph.edges.filter((edge) => edge.to === nodeId);
    const active =
      !terminalError &&
      (incoming.length === 0 ||
        incoming.some((edge) => {
          const state = states.get(edge.from);
          if (state === 'error') return edge.onError === true;
          if (state !== 'done') return false;
          if (!edge.condition) return true;
          const source = outputs[edge.from];
          return Boolean(getPath(source, `output.value`) === (edge.condition === 'true'));
        }));
    if (!active) {
      states.set(nodeId, 'skipped');
      await executorDb.stepRun.create({
        data: { workflowRunId: run.id, nodeId, status: 'skipped', input: json({}) },
      });
      await publishWorkflowEvent(run.workflow.id, run.id, { nodeId, status: 'skipped' });
      continue;
    }
    const context = bindingValues(outputs);
    const input = bindNodeConfig(node.type, node.config, context);
    const estimatedCredits = Number(
      input.creditCost ??
        (['formula', 'condition', 'delay', 'sequence.enroll'].includes(node.type) ? 0 : 1),
    );
    if (
      await budgetExceeded(workspaceId, estimatedCredits, undefined, String(input.provider ?? ''))
    ) {
      states.set(nodeId, 'skipped');
      await executorDb.stepRun.create({
        data: {
          workflowRunId: run.id,
          nodeId,
          status: 'skipped',
          input: json(input),
          error: 'budget exceeded',
        },
      });
      await publishWorkflowEvent(run.workflow.id, run.id, {
        nodeId,
        status: 'skipped',
        error: 'budget exceeded',
      });
      continue;
    }
    const step = await executorDb.stepRun.create({
      data: { workflowRunId: run.id, nodeId, status: 'running', input: json(input) },
    });
    await publishWorkflowEvent(run.workflow.id, run.id, { nodeId, status: 'started' });
    try {
      if (node.type === 'delay') {
        await executorDb.stepRun.update({
          where: { id: step.id },
          data: { status: 'done', output: json({ delayed: true }) },
        });
        await executorDb.workflowRun.update({
          where: { id: run.id },
          data: { output: json({ __outputs: outputs }) },
        });
        await workflowQueue.add(
          'run',
          { runId: run.id, workspaceId, resumeFrom: node.id },
          { delay: Math.max(0, Number(input.ms ?? 0)) },
        );
        await publishWorkflowEvent(run.workflow.id, run.id, { nodeId, status: 'done' });
        return;
      }
      const result = await executeWorkflowNode(node.type, input, context, workspaceId);
      credits += result.credits;
      outputs[node.id] = { output: result.output };
      states.set(nodeId, 'done');
      await executorDb.stepRun.update({
        where: { id: step.id },
        data: { status: 'done', output: json(result.output), credits: result.credits },
      });
      if (result.credits > 0) {
        await executorDb.creditLedger.create({
          data: {
            workspaceId,
            delta: -result.credits,
            reason: 'workflow step',
            refType: 'workflowRun',
            refId: run.id,
          },
        });
      }
      await publishWorkflowEvent(run.workflow.id, run.id, {
        nodeId,
        status: 'done',
        output: result.output,
        credits: result.credits,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow step failed';
      states.set(nodeId, 'error');
      const continues = graph.edges.some((edge) => edge.from === nodeId && edge.onError === true);
      if (!continues) terminalError = true;
      await executorDb.stepRun.update({
        where: { id: step.id },
        data: { status: 'error', error: message },
      });
      await publishWorkflowEvent(run.workflow.id, run.id, {
        nodeId,
        status: 'error',
        error: message,
      });
    }
  }
  const status = terminalError ? 'error' : 'done';
  await executorDb.workflowRun.update({
    where: { id: run.id },
    data: {
      status,
      credits,
      output: json(outputs),
      completedAt: new Date(),
    },
  });
  await publishWorkflowEvent(run.workflow.id, run.id, { status, output: outputs, credits });
}

export async function runWorkflow(job: Job<WorkflowJob>): Promise<void> {
  await executeWorkflowRun(job.data.runId, job.data.workspaceId, job.data.resumeFrom);
}

export async function closeWorkflowResources(): Promise<void> {
  await workflowQueue.close();
  await redis.quit();
  await publisher.quit();
  await closeExecutorResources();
}

export function startWorkflowWorker() {
  return new (require('bullmq').Worker)('workflows', runWorkflow, {
    connection: redis,
    concurrency: 4,
  });
}
