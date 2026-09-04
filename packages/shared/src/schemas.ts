import { z } from 'zod';
export const binding = z.string();
export const enrichmentConfig = z.object({ provider:z.string(), action:z.string(), input:z.record(z.unknown()).default({}), runCondition:z.string().optional() });
export const waterfallConfig = z.object({ providers:z.array(z.object({provider:z.string(),action:z.string(),input:z.record(z.unknown()).optional()})), accept:z.string().default('found') });
export const agentConfig = z.object({ prompt:z.string(), outputFields:z.record(z.string()), model:z.string().optional(), tools:z.array(z.string()).optional() });
export const formulaConfig = z.object({ expression:z.string() });
export const httpConfig = z.object({ method:z.enum(['GET','POST','PUT','PATCH','DELETE']), url:z.string(), headers:z.record(z.string()).optional(), body:z.unknown().optional(), outputPath:z.string().optional() });
export const inputConfig = z.object({ value:z.unknown().optional() });
export const columnConfig = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('enrichment'),config:enrichmentConfig}),
  z.object({kind:z.literal('waterfall'),config:waterfallConfig}),
  z.object({kind:z.literal('agent'),config:agentConfig}),
  z.object({kind:z.literal('formula'),config:formulaConfig}),
  z.object({kind:z.literal('http'),config:httpConfig}),
  z.object({kind:z.literal('input'),config:inputConfig}),
]);
export type ColumnConfig = z.infer<typeof columnConfig>;
