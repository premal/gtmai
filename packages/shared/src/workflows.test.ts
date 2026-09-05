import { describe, expect, it } from 'vitest';
import {
  topologicalOrder,
  validateWorkflowGraph,
  validateWorkflowGraphDetailed,
  type WorkflowGraph,
} from './workflows';

const node = (id: string) => ({
  id,
  type: 'formula' as const,
  config: {},
  position: { x: 0, y: 0 },
});

describe('workflow graph validation', () => {
  it('orders a DAG', () => {
    const graph: WorkflowGraph = { nodes: [node('a'), node('b')], edges: [{ from: 'a', to: 'b' }] };
    expect(topologicalOrder(graph)).toEqual(['a', 'b']);
    expect(validateWorkflowGraph(graph)).toEqual([]);
  });

  it('rejects cycles', () => {
    const graph: WorkflowGraph = {
      nodes: [node('a'), node('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(validateWorkflowGraph(graph)).toContain('Workflow graph contains a cycle');
  });

  it('reports unresolved bindings and condition branch warnings', () => {
    const result = validateWorkflowGraphDetailed({
      nodes: [
        {
          id: 'condition',
          type: 'condition',
          config: { expression: '{{missing.output}}' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });
    expect(result.errors).toContain('Unresolvable binding in condition: {{missing.output}}');
    expect(result.warnings).toContain('Condition node condition should have true and false edges');
  });
});
