'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkflowConfig } from './builders/workflow-config';

export type EditorNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
};
export type EditorEdge = { from: string; to: string; condition?: string; onError?: boolean };
export type EditorGraph = { nodes: EditorNode[]; edges: EditorEdge[] };

type Props = {
  graph: EditorGraph;
  onChange: (graph: EditorGraph) => void;
  statuses?: Record<string, string>;
  outputs?: Record<string, unknown>;
};

const palette = [
  'trigger.manual',
  'trigger.signal',
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
];

export function WorkflowEditor({ graph, onChange, statuses = {}, outputs = {} }: Props) {
  const [selected, setSelected] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedNode = graph.nodes.find((node) => node.id === selected);
  const bindings = useMemo(() => {
    const values = ['{{trigger.email}}', '{{trigger.domain}}'];
    graph.nodes.forEach((node) => values.push(`{{${node.id}.output}}`));
    Object.keys(outputs).forEach((key) => values.push(`{{${key}}}`));
    return values;
  }, [graph.nodes, outputs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') return;
      if (selectedEdge !== null) {
        onChange({ ...graph, edges: graph.edges.filter((_, index) => index !== selectedEdge) });
        setSelectedEdge(null);
      } else if (selected) {
        onChange({
          nodes: graph.nodes.filter((node) => node.id !== selected),
          edges: graph.edges.filter((edge) => edge.from !== selected && edge.to !== selected),
        });
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graph, onChange, selected, selectedEdge]);

  function addNode(type: string) {
    const base = type.split('.').pop() ?? type;
    let index = 1;
    while (graph.nodes.some((node) => node.id === `${base}_${index}`)) index++;
    const node = {
      id: `${base}_${index}`,
      type,
      config: {},
      position: {
        x: 80 + (graph.nodes.length % 3) * 230,
        y: 60 + Math.floor(graph.nodes.length / 3) * 150,
      },
    };
    onChange({ ...graph, nodes: [...graph.nodes, node] });
    setSelected(node.id);
  }

  function moveNode(nodeId: string, event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const origin = { ...node.position };
    const start = { x: event.clientX, y: event.clientY };
    const move = (next: globalThis.PointerEvent) =>
      onChange({
        ...graph,
        nodes: graph.nodes.map((item) =>
          item.id === nodeId
            ? {
                ...item,
                position: {
                  x: Math.max(0, origin.x + next.clientX - start.x),
                  y: Math.max(0, origin.y + next.clientY - start.y),
                },
              }
            : item,
        ),
      });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function addEdge(to: string) {
    if (!edgeStart || edgeStart === to) return;
    if (!graph.edges.some((edge) => edge.from === edgeStart && edge.to === to))
      onChange({ ...graph, edges: [...graph.edges, { from: edgeStart, to }] });
    setEdgeStart(null);
  }

  return (
    <div className="editor-layout">
      <div className="panel palette">
        <h3>Node palette</h3>
        {palette.map((type) => (
          <button className="palette-item" key={type} onClick={() => addNode(type)}>
            {type}
          </button>
        ))}
        <button className="button" onClick={() => setPan({ x: 0, y: 0 })}>
          Auto-fit
        </button>
      </div>
      <div
        className="panel workflow-canvas"
        ref={canvasRef}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const start = { x: event.clientX, y: event.clientY };
          const origin = { ...pan };
          const move = (next: globalThis.PointerEvent) =>
            setPan({ x: origin.x + next.clientX - start.x, y: origin.y + next.clientY - start.y });
          const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', stop);
        }}
      >
        <div
          className="canvas-surface editor-canvas"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <svg className="edge-layer">
            {graph.edges.map((edge, index) => {
              const from = graph.nodes.find((node) => node.id === edge.from);
              const to = graph.nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const x1 = from.position.x + 170;
              const y1 = from.position.y + 35;
              const x2 = to.position.x;
              const y2 = to.position.y + 35;
              return (
                <g key={`${edge.from}-${edge.to}-${index}`} onClick={() => setSelectedEdge(index)}>
                  <path
                    className={selectedEdge === index ? 'selected-edge' : ''}
                    d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
                  />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>
                    {edge.condition ?? ''}
                  </text>
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((node) => (
            <div
              key={node.id}
              className={`workflow-node draggable ${selected === node.id ? 'selected' : ''}`}
              style={{ left: node.position.x, top: node.position.y }}
              onClick={() => setSelected(node.id)}
              onPointerDown={(event) => moveNode(node.id, event)}
            >
              <span className={`status-dot ${statuses[node.id] ?? ''}`} />
              <span>{node.type}</span>
              <strong>{node.id}</strong>
              <button
                className="node-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange({
                    ...graph,
                    nodes: graph.nodes.filter((item) => item.id !== node.id),
                    edges: graph.edges.filter(
                      (edge) => edge.from !== node.id && edge.to !== node.id,
                    ),
                  });
                }}
              >
                ×
              </button>
              <button
                className="node-handle"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setEdgeStart(node.id);
                }}
                aria-label="Start edge"
              >
                ●
              </button>
              {edgeStart && edgeStart !== node.id && (
                <button
                  className="node-target"
                  onClick={(event) => {
                    event.stopPropagation();
                    addEdge(node.id);
                  }}
                >
                  ○
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="panel config-panel">
        <h3>{selectedNode ? `Configure ${selectedNode.id}` : 'Select a node'}</h3>
        {selectedNode && (
          <WorkflowConfig
            type={selectedNode.type}
            config={selectedNode.config}
            bindings={bindings}
            onChange={(config) =>
              onChange({
                ...graph,
                nodes: graph.nodes.map((node) =>
                  node.id === selectedNode.id ? { ...node, config } : node,
                ),
              })
            }
          />
        )}
      </div>
    </div>
  );
}
