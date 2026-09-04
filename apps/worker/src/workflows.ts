import { Queue, type Job } from 'bullmq';
import { Prisma } from '@gtmai/db';
import {
  evaluateFormula,
  getPath,
  resolveBindings,
  topologicalOrder,
  type WorkflowGraph,
} from '@gtmai/shared';
import {
  executeAgent,
  executeEnrichment,
  executeFormula,
  executeHttp,
  executeWaterfall,
  executorDb,
  type Values,
} from './executors';

const redis = new (require('ioredis'))(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
}) as import('ioredis').default;
const publisher = new (require('ioredis'))(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
) as import('ioredis').default;
const workflowQueue = new Queue('workflows', { connection: redis });
const json = (value: unknown) => value as Prisma.InputJsonValue;

type WorkflowJob = { runId: string; workspaceId: string; resumeFrom?: string };
type NodeState = 'done' | 'error' | 'skipped';

function bindingValues(outputs: Values): Values {
  const values: Values = { ...outputs };
  for (const [nodeId, value] of Object.entries(outputs)) {
    if (!value || typeof value !== 'object') continue;
    values[`${nodeId}.output`] = (value as Values).output;
    const output = (value as Values).output;
    if (output && typeof output === 'object') {
      for (const [key, item] of Object.entries(output as Values)) {
        values[`${nodeId}.output.${key}`] = item;
      }
    }
  }
  return values;
}

function bindConfig(config: Values, outputs: Values): Values {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      typeof value === 'string' ? resolveBindings(value, outputs) : value,
    ]),
  );
}

function conditionExpression(expression: string): string {
  const match = expression.match(/^\s*(\{\{[^}]+}})\s+contains\s+("[^"]*"|'[^']*')\s*$/i);
  return match ? `contains(${match[1]}, ${match[2]})` : expression;
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
  const outputs: Values = { inputs: { output: input } };
  let credits = 0;
  for (const node of program.nodes ?? []) {
    const context = bindingValues(outputs);
    const result = await executeWorkflowNode(
      node.type,
      bindConfig(node.config, context),
      context,
      workspaceId,
    );
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
        value: Boolean(
          executeFormula(conditionExpression(String(config.expression ?? '')), context),
        ),
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
      const resolved = typeof value === 'string' ? resolveBindings(value, context) : value;
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

export async function runWorkflow(job: Job<WorkflowJob>): Promise<void> {
  const run = await executorDb.workflowRun.findUnique({
    where: { id: job.data.runId },
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
  const resumeIndex = job.data.resumeFrom ? order.indexOf(job.data.resumeFrom) + 1 : 0;
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
      await publisher.publish(`workflow:${run.id}`, JSON.stringify({ nodeId, status: 'skipped' }));
      continue;
    }
    const context = bindingValues(outputs);
    const input = bindConfig(node.config, context);
    const step = await executorDb.stepRun.create({
      data: { workflowRunId: run.id, nodeId, status: 'running', input: json(input) },
    });
    await publisher.publish(`workflow:${run.id}`, JSON.stringify({ nodeId, status: 'started' }));
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
          { runId: run.id, workspaceId: job.data.workspaceId, resumeFrom: node.id },
          { delay: Math.max(0, Number(input.ms ?? 0)) },
        );
        await publisher.publish(`workflow:${run.id}`, JSON.stringify({ nodeId, status: 'done' }));
        return;
      }
      const result = await executeWorkflowNode(node.type, input, context, job.data.workspaceId);
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
            workspaceId: job.data.workspaceId,
            delta: -result.credits,
            reason: 'workflow step',
            refType: 'workflowRun',
            refId: run.id,
          },
        });
      }
      await publisher.publish(
        `workflow:${run.id}`,
        JSON.stringify({ nodeId, status: 'done', output: result.output, credits: result.credits }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow step failed';
      states.set(nodeId, 'error');
      const continues = graph.edges.some((edge) => edge.from === nodeId && edge.onError === true);
      if (!continues) terminalError = true;
      await executorDb.stepRun.update({
        where: { id: step.id },
        data: { status: 'error', error: message },
      });
      await publisher.publish(
        `workflow:${run.id}`,
        JSON.stringify({ nodeId, status: 'error', error: message }),
      );
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
  await publisher.publish(
    `workflow:${run.id}`,
    JSON.stringify({ status, output: outputs, credits }),
  );
}

export function startWorkflowWorker() {
  return new (require('bullmq').Worker)('workflows', runWorkflow, {
    connection: redis,
    concurrency: 4,
  });
}
