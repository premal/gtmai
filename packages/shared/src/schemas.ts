import { z } from 'zod';
export const binding = z.string();
const providerRef = z.object({
  provider: z.string(),
  action: z.string(),
  input: z.record(z.unknown()).optional(),
});
const maxCost = z.number().positive().optional();
export const enrichmentConfig = z.object({
  provider: z.string(),
  action: z.string(),
  input: z.record(z.unknown()).default({}),
  runCondition: z.string().optional(),
  maxCost,
});
export const waterfallConfig = z.object({
  providers: z.array(providerRef),
  accept: z.string().default('found'),
  validate: providerRef.optional(),
  maxCost,
});
export const agentConfig = z.object({
  prompt: z.string(),
  outputFields: z.record(z.string()),
  provider: z
    .enum(['openai', 'anthropic', 'gemini', 'perplexity', 'openrouter', 'cometapi'])
    .default('openai'),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  maxCost,
});
export const formulaConfig = z.object({ expression: z.string() });
export const httpConfig = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  outputPath: z.string().optional(),
  maxCost,
});
export const inputConfig = z.object({ value: z.unknown().optional() });
export const columnConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enrichment'), config: enrichmentConfig }),
  z.object({ kind: z.literal('waterfall'), config: waterfallConfig }),
  z.object({ kind: z.literal('agent'), config: agentConfig }),
  z.object({ kind: z.literal('formula'), config: formulaConfig }),
  z.object({ kind: z.literal('http'), config: httpConfig }),
  z.object({ kind: z.literal('input'), config: inputConfig }),
]);
export type ColumnConfig = z.infer<typeof columnConfig>;

export const metapromptResult = z.object({
  name: z.string().min(1),
  kind: z.enum(['enrichment', 'waterfall', 'agent', 'formula', 'http']),
  type: z.enum(['text', 'number', 'boolean', 'date', 'url', 'email', 'json']).default('text'),
  config: z.record(z.unknown()).default({}),
  runCondition: z.string().optional(),
});
export type MetapromptResult = z.infer<typeof metapromptResult>;

export const signalConfig = z
  .object({
    provider: z.string().optional(),
    action: z.string().optional(),
    schedule: z.enum(['hourly', 'daily', 'weekly', 'monthly']).optional(),
    sourceTableId: z.string().optional(),
    domainColumn: z.string().optional(),
    emailColumn: z.string().optional(),
    keywords: z.string().optional(),
    alertChannelId: z.string().optional(),
  })
  .passthrough();
export type SignalConfig = z.infer<typeof signalConfig>;

export const generatedSequence = z.object({
  steps: z
    .array(
      z.object({
        delayHours: z.number().int().nonnegative().default(0),
        subjectTemplate: z.string().default(''),
        bodyTemplate: z.string().min(1),
      }),
    )
    .min(1),
});
export type GeneratedSequence = z.infer<typeof generatedSequence>;
