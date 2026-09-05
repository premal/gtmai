import { z } from 'zod';
import { findBindings } from './bindings';

export const workflowNodeTypes = [
  'trigger.manual',
  'trigger.signal',
  'trigger.schedule',
  'trigger.webhook',
  'enrich',
  'waterfall',
  'agent',
  'formula',
  'function',
  'condition',
  'http',
  'audience.upsert',
  'table.appendRow',
  'delay',
  'webhook.out',
] as const;

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(workflowNodeTypes),
  config: z.record(z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});

export const workflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
  onError: z.boolean().optional(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type WorkflowValidation = { errors: string[]; warnings: string[] };

export function topologicalOrder(graph: WorkflowGraph): string[] {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) {
      throw new Error(`Unknown workflow node in edge ${edge.from}->${edge.to}`);
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const result: string[] = [];
  while (queue.length) {
    const nodeId = queue.shift()!;
    result.push(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) {
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  if (result.length !== graph.nodes.length) {
    throw new Error('Workflow graph contains a cycle');
  }
  return result;
}

export function validateWorkflowGraph(graph: WorkflowGraph): string[] {
  return validateWorkflowGraphDetailed(graph).errors;
}

export function validateWorkflowGraphDetailed(graph: WorkflowGraph): WorkflowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      errors.push(`Edge references unknown node: ${edge.from}->${edge.to}`);
    }
  }
  try {
    topologicalOrder(graph);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid workflow graph');
  }
  for (const node of graph.nodes) {
    const text = JSON.stringify(node.config);
    for (const binding of findBindings(text)) {
      const root = binding.split('.')[0] ?? '';
      if (root !== 'trigger' && root !== 'inputs' && !ids.has(root)) {
        errors.push(`Unresolvable binding in ${node.id}: {{${binding}}}`);
      }
    }
    if (node.type === 'condition') {
      const conditions = new Set(
        graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.condition),
      );
      if (!conditions.has('true') || !conditions.has('false')) {
        warnings.push(`Condition node ${node.id} should have true and false edges`);
      }
    }
  }
  return { errors, warnings };
}
