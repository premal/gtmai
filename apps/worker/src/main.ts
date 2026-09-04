import { Worker, type Job } from 'bullmq';
import { createDecipheriv } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaClient } from '@gtmai/db';
import { providers, runAgent, type ActionResult, type ProviderAction } from '@gtmai/providers';
import { evaluateFormula, findBindings, resolveBindings } from '@gtmai/shared';

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

export type CellData = { rowId: string; columnId: string; workspaceId: string };
type Values = Record<string, unknown>;
type ProviderConfig = { provider: string; action: string; input?: Values };

function getJsonPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Values)[key];
    }
    return undefined;
  }, value);
}

export function evaluateWorkerFormula(expression: string, values: Values): unknown {
  return evaluateFormula(expression, values);
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

function encryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes in hex');
  return key;
}

function decrypt(value: string): Record<string, string> {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
  ) as Record<string, string>;
}

function rowValues(row: { cells: { value: unknown; column: { name: string } }[] }): Values {
  return Object.fromEntries(row.cells.map((cell) => [cell.column.name, cell.value]));
}

async function limitProvider(provider: string): Promise<void> {
  const key = `provider-rate:${provider}:${Math.floor(Date.now() / 1000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 1);
  const max = Number(process.env.PROVIDER_RATE_LIMIT ?? 10);
  if (count > max) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function runAction(
  providerId: string,
  actionId: string,
  input: Values,
  workspaceId: string,
): Promise<{ result: ActionResult<unknown>; action: ProviderAction; provider: string }> {
  const provider = providers.find((item) => item.id === providerId);
  const action = provider?.actions.find((item) => item.id === actionId);
  if (!provider || !action) throw new Error(`Provider action not found: ${providerId}/${actionId}`);
  const connection = await db.connection.findFirst({
    where: { workspaceId, provider: providerId },
  });
  if (!connection) throw new Error(`No connection for ${providerId}`);
  await limitProvider(providerId);
  const credentials = decrypt(connection.encryptedCredentials);
  const result = await action.run(input, {
    credentials,
    fetch,
    logger: { info: () => undefined, error: () => undefined },
  });
  return { result, action, provider: providerId };
}

function accepted(result: ActionResult<unknown>, rule: string | undefined): boolean {
  if (!result.found) return false;
  if (rule === 'verified-email-only') {
    const data = result.data as Values;
    return data.emailStatus === 'verified' || data.email_status === 'verified';
  }
  return true;
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
      await queue.add('cell', { rowId, columnId: column.id, workspaceId });
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
    let result: ActionResult<unknown>;
    let provider = 'formula';
    if (column.kind === 'formula') {
      result = {
        found: true,
        data: evaluateWorkerFormula(String(config.expression ?? ''), values),
      };
    } else if (column.kind === 'waterfall') {
      result = { found: false };
      let attempted = false;
      for (const item of (config.providers ?? []) as ProviderConfig[]) {
        const input = Object.fromEntries(
          Object.entries(item.input ?? {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? resolveBindings(value, values) : value,
          ]),
        );
        if (hasMissingInputs(input)) continue;
        attempted = true;
        const current = await runAction(item.provider, item.action, input, workspaceId);
        if (accepted(current.result, String(config.accept ?? ''))) {
          result = current.result;
          provider = current.provider;
          creditsUsed = current.action.creditCost;
          break;
        }
      }
      if (!attempted) {
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
      const input = Object.fromEntries(
        Object.entries((config.input ?? {}) as Values).map(([key, value]) => [
          key,
          typeof value === 'string' ? resolveBindings(value, values) : value,
        ]),
      );
      if (hasMissingInputs(input)) {
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
      const current = await runAction(
        String(config.provider),
        String(config.action),
        input,
        workspaceId,
      );
      result = current.result;
      provider = current.provider;
      creditsUsed = current.result.found ? current.action.creditCost : 0;
    } else if (column.kind === 'agent') {
      const agentProvider = config.provider === 'anthropic' ? 'anthropic' : 'openai';
      const connection = await db.connection.findFirst({
        where: {
          workspaceId,
          provider: { in: [agentProvider, 'llm'] },
        },
      });
      if (!connection) {
        throw new Error(`No connection for ${agentProvider} — add one in Connections`);
      }
      const agent = await runAgent(
        resolveBindings(String(config.prompt ?? ''), values),
        {
          credentials: decrypt(connection.encryptedCredentials),
          fetch,
          logger: { info: () => undefined, error: () => undefined },
        },
        agentProvider,
        typeof config.model === 'string' ? config.model : undefined,
      );
      result = { found: true, data: agent };
      provider = String(config.provider ?? 'llm');
    } else if (column.kind === 'http') {
      const current = await runAction(
        'http',
        'http.request',
        {
          method: config.method ?? 'GET',
          url: resolveBindings(String(config.url ?? ''), values),
          headers: config.headers ?? {},
          body: config.body ? resolveBindings(String(config.body), values) : undefined,
        },
        workspaceId,
      );
      result = current.result;
      if (result.found && config.outputPath) {
        result = { ...result, data: getJsonPath(result.data, String(config.outputPath)) };
      }
      provider = current.provider;
      creditsUsed = current.result.found ? current.action.creditCost : 0;
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
    await db.cell.update({
      where: { id: cell.id },
      data: { status: 'error', error: message, durationMs: Date.now() - started },
    });
    await publisher.publish(
      `table:${column.tableId}`,
      JSON.stringify({ rowId, columnId, status: 'error', error: message }),
    );
    throw error;
  }
}

export function startWorker(): Worker<CellData> {
  encryptionKey();
  return new Worker<CellData>('cells', execute, {
    connection: redis,
    concurrency: Number(process.env.CELL_CONCURRENCY ?? 20),
  });
}

if (process.env.NODE_ENV !== 'test') startWorker();
