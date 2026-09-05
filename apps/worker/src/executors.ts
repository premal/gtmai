import { createDecipheriv } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaClient } from '@gtmai/db';
import { providers, runAgent, type ActionResult, type ProviderAction } from '@gtmai/providers';
import { evaluateFormula, resolveBindings, resolveBindingsDeep } from '@gtmai/shared';

export type Values = Record<string, unknown>;
export type EnrichmentConfig = {
  provider?: string;
  action?: string;
  input?: Values;
};
export type WaterfallConfig = {
  providers?: Array<{ provider: string; action: string; input?: Values }>;
  accept?: string;
};
export type ExecutionResult = {
  result: ActionResult<unknown>;
  provider: string;
  creditsUsed: number;
  sources?: unknown;
  reasoning?: unknown;
};

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

function encryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes in hex');
  return key;
}

export function validateEncryptionKey(): void {
  encryptionKey();
}

export function decryptCredentials(value: string): Record<string, string> {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
  ) as Record<string, string>;
}

async function limitProvider(provider: string): Promise<void> {
  const key = `provider-rate:${provider}:${Math.floor(Date.now() / 1000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 1);
  const max = Number(process.env.PROVIDER_RATE_LIMIT ?? 10);
  if (count > max) await new Promise((resolve) => setTimeout(resolve, 1_000));
}

export async function runProviderAction(
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
  const result = await action.run(input, {
    credentials: decryptCredentials(connection.encryptedCredentials),
    fetch,
    logger: { info: () => undefined, error: () => undefined },
  });
  return { result, action, provider: providerId };
}

export function executeFormula(expression: string, values: Values): unknown {
  return evaluateFormula(expression, values);
}

function boundInputs(input: Values | undefined, values: Values): Values {
  return resolveBindingsDeep(input ?? {}, values);
}

export function acceptsWaterfallResult(
  result: ActionResult<unknown>,
  rule: string | undefined,
): boolean {
  if (!result.found) return false;
  if (rule !== 'verified-email-only') return true;
  const data = result.data as Values;
  return data.emailStatus === 'verified' || data.email_status === 'verified';
}

export async function executeEnrichment(
  config: EnrichmentConfig,
  values: Values,
  workspaceId: string,
): Promise<ExecutionResult> {
  const input = boundInputs(config.input, values);
  if (
    Object.values(input).length === 0 ||
    Object.values(input).every(
      (value) =>
        value === null || value === undefined || (typeof value === 'string' && !value.trim()),
    )
  ) {
    return { result: { found: false, reason: 'missing inputs' }, provider: '', creditsUsed: 0 };
  }
  const current = await runProviderAction(
    String(config.provider ?? 'mock'),
    String(config.action ?? 'mock.enrichPerson'),
    input,
    workspaceId,
  );
  return {
    result: current.result,
    provider: current.provider,
    creditsUsed: current.result.found ? current.action.creditCost : 0,
  };
}

export async function executeWaterfall(
  config: WaterfallConfig,
  values: Values,
  workspaceId: string,
): Promise<ExecutionResult> {
  let attempted = false;
  for (const item of config.providers ?? []) {
    const input = boundInputs(item.input, values);
    if (
      Object.values(input).length === 0 ||
      Object.values(input).every(
        (value) =>
          value === null || value === undefined || (typeof value === 'string' && !value.trim()),
      )
    ) {
      continue;
    }
    attempted = true;
    let current: { result: ActionResult<unknown>; action: ProviderAction; provider: string };
    try {
      current = await runProviderAction(item.provider, item.action, input, workspaceId);
    } catch {
      continue;
    }
    if (acceptsWaterfallResult(current.result, config.accept)) {
      return {
        result: current.result,
        provider: current.provider,
        creditsUsed: current.action.creditCost,
      };
    }
  }
  return {
    result: {
      found: false,
      reason: attempted ? 'No provider accepted the result' : 'missing inputs',
    },
    provider: '',
    creditsUsed: 0,
  };
}

export async function executeAgent(
  config: Values,
  values: Values,
  workspaceId: string,
): Promise<ExecutionResult> {
  const agentProvider = config.provider === 'anthropic' ? 'anthropic' : 'openai';
  const connection = await db.connection.findFirst({
    where: { workspaceId, provider: { in: [agentProvider, 'llm'] } },
  });
  if (!connection) {
    throw new Error(`No connection for ${agentProvider} — add one in Connections`);
  }
  const agent = await runAgent(
    resolveBindings(String(config.prompt ?? ''), values),
    {
      credentials: decryptCredentials(connection.encryptedCredentials),
      fetch,
      logger: { info: () => undefined, error: () => undefined },
    },
    agentProvider,
    typeof config.model === 'string' ? config.model : undefined,
  );
  return { result: { found: true, data: agent }, provider: agentProvider, creditsUsed: 5 };
}

export async function executeHttp(
  config: Values,
  values: Values,
  _workspaceId: string,
): Promise<ExecutionResult> {
  const request: RequestInit = {
    method: String(config.method ?? 'GET'),
    headers: resolveBindingsDeep(config.headers ?? {}, values) as Record<string, string>,
  };
  if (config.body) {
    const body = resolveBindingsDeep(config.body, values);
    request.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(resolveBindings(String(config.url ?? ''), values), request);
  const raw = await response.text();
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Preserve non-JSON responses as text.
  }
  let result: ActionResult<unknown> = response.ok
    ? { found: true, data }
    : { found: false, reason: `HTTP ${response.status}` };
  if (result.found && config.outputPath) {
    const data = String(config.outputPath)
      .split('.')
      .reduce<unknown>((currentValue, key) => {
        if (currentValue && typeof currentValue === 'object') {
          return (currentValue as Values)[key];
        }
        return undefined;
      }, result.data);
    result = { ...result, data };
  }
  return {
    result,
    provider: 'http',
    creditsUsed: 0,
  };
}

export const executorDb: PrismaClient = db;

export async function closeExecutorResources(): Promise<void> {
  await db.$disconnect();
  await redis.quit();
}
