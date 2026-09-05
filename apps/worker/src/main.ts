import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@gtmai/db';
import type { ActionResult } from '@gtmai/providers';
import { findBindings, resolveBindings } from '@gtmai/shared';
import { startPhase2Workers } from './phase2-worker';
import {
  executeAgent,
  executeEnrichment,
  executeFormula,
  executeHttp,
  executeWaterfall,
  validateEncryptionKey,
} from './executors';
import { budgetErrorMessage, budgetExceeded } from './budgets';

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

export type CellData = { rowId: string; columnId: string; workspaceId: string };
type Values = Record<string, unknown>;
export function evaluateWorkerFormula(expression: string, values: Values): unknown {
  return executeFormula(expression, values);
}

export function hasMissingInputs(input: Values): boolean {
  const values = Object.values(input);
  return (
    values.length === 0 ||
    values.every(
      (value) =>
        value === null || value === undefined || (typeof value === 'string' && value.trim() === ''),
    )
  );
}

const cellJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
};

function rowValues(row: { cells: { value: unknown; column: { name: string } }[] }): Values {
  return Object.fromEntries(row.cells.map((cell) => [cell.column.name, cell.value]));
}

async function enqueueDependents(
  tableId: string,
  completedName: string,
  rowId: string,
  workspaceId: string,
) {
  const columns = await db.column.findMany({ where: { tableId } });
  const queue = new (await import('bullmq')).Queue<CellData>('cells', { connection: redis });
  for (const column of columns) {
    const config = column.config as Values;
    const text = JSON.stringify(config);
    if (findBindings(text).includes(completedName)) {
      await db.cell.upsert({
        where: { rowId_columnId: { rowId, columnId: column.id } },
        create: { rowId, columnId: column.id, status: 'queued' },
        update: { status: 'queued', error: null },
      });
      await queue.add('cell', { rowId, columnId: column.id, workspaceId }, cellJobOptions);
    }
  }
  await queue.close();
}

async function execute(job: Job<CellData>): Promise<void> {
  const { rowId, columnId, workspaceId } = job.data;
  const column = await db.column.findFirst({
    where: { id: columnId, table: { workspaceId } },
    include: { table: true },
  });
  const row = await db.row.findUnique({
    where: { id: rowId },
    include: { cells: { include: { column: true } } },
  });
  if (!column || !row) throw new Error('Cell target not found');
  const values = rowValues(row);
  const claimed = await db.cell.updateMany({
    where: { rowId, columnId, status: 'queued' },
    data: { status: 'running', error: null },
  });
  if (claimed.count === 0) return;
  const cell = await db.cell.findUniqueOrThrow({
    where: { rowId_columnId: { rowId, columnId } },
  });
  await publisher.publish(
    `table:${column.tableId}`,
    JSON.stringify({ rowId, columnId, status: 'running' }),
  );
  const started = Date.now();
  let creditsUsed = 0;
  try {
    if (column.runCondition && !evaluateWorkerFormula(column.runCondition, values)) {
      await db.cell.update({
        where: { id: cell.id },
        data: { status: 'skipped', durationMs: Date.now() - started },
      });
      return;
    }
    const config = column.config as Values;
    const estimatedCredits = Number(
      config.creditCost ??
        (column.kind === 'agent' ? 5 : ['formula', 'input'].includes(column.kind) ? 0 : 1),
    );
    const exceededBudget = await budgetExceeded(
      workspaceId,
      estimatedCredits,
      column.tableId,
      String(config.provider ?? ''),
    );
    if (exceededBudget) {
      const table = await db.table.findUnique({
        where: { id: column.tableId },
        select: { name: true, workbook: { select: { name: true } } },
      });
      const budgetError = budgetErrorMessage(
        exceededBudget.scope,
        table
          ? {
              ...(table.workbook?.name ? { workbook: table.workbook.name } : {}),
              ...(table.name ? { table: table.name } : {}),
            }
          : {},
      );
      await db.cell.update({
        where: { id: cell.id },
        data: {
          status: 'skipped',
          error: budgetError,
          creditsUsed: 0,
          durationMs: Date.now() - started,
        },
      });
      await publisher.publish(
        `table:${column.tableId}`,
        JSON.stringify({ rowId, columnId, status: 'skipped', error: budgetError }),
      );
      return;
    }
    let result: ActionResult<unknown>;
    let provider = 'formula';
    if (column.kind === 'formula') {
      result = {
        found: true,
        data: evaluateWorkerFormula(String(config.expression ?? ''), values),
      };
    } else if (column.kind === 'waterfall') {
      const current = await executeWaterfall(config, values, workspaceId);
      result = current.result;
      provider = current.provider;
      creditsUsed = current.creditsUsed;
      if (!current.result.found && current.result.reason === 'missing inputs') {
        await db.cell.update({
          where: { id: cell.id },
          data: { status: 'skipped', error: 'missing inputs', durationMs: Date.now() - started },
        });
        await publisher.publish(
          `table:${column.tableId}`,
          JSON.stringify({ rowId, columnId, status: 'skipped', error: 'missing inputs' }),
        );
        return;
      }
    } else if (column.kind === 'enrichment') {
      const current = await executeEnrichment(config, values, workspaceId);
      result = current.result;
      provider = current.provider;
      creditsUsed = current.creditsUsed;
      if (!current.result.found && current.result.reason === 'missing inputs') {
        await db.cell.update({
          where: { id: cell.id },
          data: { status: 'skipped', error: 'missing inputs', durationMs: Date.now() - started },
        });
        await publisher.publish(
          `table:${column.tableId}`,
          JSON.stringify({ rowId, columnId, status: 'skipped', error: 'missing inputs' }),
        );
        return;
      }
    } else if (column.kind === 'agent') {
      const current = await executeAgent(config, values, workspaceId);
      result = current.result;
      provider = current.provider;
      creditsUsed = current.creditsUsed;
    } else if (column.kind === 'http') {
      const current = await executeHttp(config, values, workspaceId);
      result = current.result;
      provider = current.provider;
      creditsUsed = current.creditsUsed;
    } else if (column.kind === 'function') {
      const functionId = String(config.functionId ?? '');
      const versionNumber = typeof config.version === 'number' ? config.version : undefined;
      const version = await db.functionVersion.findFirst({
        where: { functionId, ...(versionNumber ? { version: versionNumber } : {}) },
        orderBy: { version: 'desc' },
      });
      if (!version) throw new Error('Function version not found');
      const program = version.program as { output?: string };
      const bindings = (config.input ?? {}) as Values;
      const input = Object.fromEntries(
        Object.entries(bindings).map(([key, value]) => [
          key,
          typeof value === 'string' ? resolveBindings(value, values) : value,
        ]),
      );
      result = {
        found: true,
        data: typeof program.output === 'string' ? resolveBindings(program.output, input) : input,
      };
      provider = 'function';
    } else {
      result = { found: true, data: config.value ?? null };
    }
    if (!result.found) throw new Error(result.reason ?? 'No result');
    await db.cell.update({
      where: { id: cell.id },
      data: {
        value: result.data as object,
        status: 'done',
        provider,
        creditsUsed,
        durationMs: Date.now() - started,
        provenance:
          result.found && result.data && typeof result.data === 'object'
            ? {
                provider,
                sources: (result.data as Values).sources ?? [],
                reasoning: (result.data as Values).reasoning ?? undefined,
              }
            : { provider },
      },
    });
    if (creditsUsed > 0) {
      await db.creditLedger.create({
        data: {
          workspaceId,
          tableId: column.tableId,
          provider,
          delta: -creditsUsed,
          reason: 'cell execution',
          refType: 'cell',
          refId: cell.id,
        },
      });
    }
    await publisher.publish(
      `table:${column.tableId}`,
      JSON.stringify({ rowId, columnId, status: 'done', value: result.data, provider }),
    );
    await enqueueDependents(column.tableId, column.name, rowId, workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution failed';
    const finalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);
    if (finalAttempt) {
      await db.cell.update({
        where: { id: cell.id },
        data: { status: 'error', error: message, durationMs: Date.now() - started },
      });
      await publisher.publish(
        `table:${column.tableId}`,
        JSON.stringify({ rowId, columnId, status: 'error', error: message }),
      );
    } else {
      await db.cell.update({
        where: { id: cell.id },
        data: { status: 'queued', error: null },
      });
    }
    throw error;
  }
}

export function startWorker(): Worker<CellData> {
  validateEncryptionKey();
  return new Worker<CellData>('cells', execute, {
    connection: redis,
    concurrency: Number(process.env.CELL_CONCURRENCY ?? 20),
  });
}

if (process.env.NODE_ENV !== 'test') {
  startWorker();
  startPhase2Workers();
}
