'use client';

import { use, useEffect, useMemo, useState } from 'react';
import type { PointerEvent } from 'react';
import { Phase2Nav } from '../../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Node = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
};
type Workflow = {
  id: string;
  name: string;
  graph: { nodes: Node[]; edges: Array<{ from: string; to: string }> };
};
type Run = { id: string; status: string; output?: unknown };

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState('');
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');

  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [workflowResponse, runsResponse] = await Promise.all([
      fetch(`${api}/workflows`, { headers }),
      fetch(`${api}/workflows/${id}/runs`, { headers }),
    ]);
    if (workflowResponse.ok) {
      const workflows = (await workflowResponse.json()) as Workflow[];
      setWorkflow(workflows.find((item) => item.id === id) ?? null);
    }
    if (runsResponse.ok) setRuns((await runsResponse.json()) as Run[]);
  }

  useEffect(() => {
    if (token) void load();
  }, [token, id]);

  const nodeMap = useMemo(
    () => new Map((workflow?.graph.nodes ?? []).map((node) => [node.id, node])),
    [workflow],
  );

  function moveNode(id: string, event: PointerEvent<HTMLDivElement>) {
    if (!workflow) return;
    const origin = nodeMap.get(id);
    if (!origin) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: globalThis.PointerEvent) => {
      setWorkflow((current) =>
        current
          ? {
              ...current,
              graph: {
                ...current.graph,
                nodes: current.graph.nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        position: {
                          x: Math.max(0, origin.position.x + next.clientX - startX),
                          y: Math.max(0, origin.position.y + next.clientY - startY),
                        },
                      }
                    : node,
                ),
              },
            }
          : current,
      );
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  async function save() {
    if (!workflow) return;
    await fetch(`${api}/workflows/${workflow.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ graph: workflow.graph }),
    });
    setMessage('Workflow saved');
  }

  async function run() {
    if (!workflow) return;
    await fetch(`${api}/workflows/${workflow.id}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    setMessage('Workflow run queued');
    await load();
  }

  if (!workflow) {
    return (
      <main className="app-shell">
        <Phase2Nav active="workflows" />
        <section className="content empty-state">Loading workflow…</section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Phase2Nav active="workflows" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKFLOW EDITOR</div>
            <h2>{workflow.name}</h2>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => void save()}>
              Save
            </button>
            <button className="button primary" onClick={() => void run()}>
              ▶ Run
            </button>
          </div>
        </header>
        <div className="editor-layout">
          <div className="panel palette">
            <h3>Node palette</h3>
            {[
              'enrich',
              'waterfall',
              'formula',
              'function',
              'condition',
              'delay',
              'webhook.out',
            ].map((type) => (
              <span className="palette-item" key={type}>
                {type}
              </span>
            ))}
          </div>
          <div className="panel workflow-canvas">
            <div className="canvas-surface editor-canvas">
              <svg className="edge-layer" aria-hidden="true">
                {workflow.graph.edges.map((edge) => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to) return null;
                  const x1 = from.position.x + 70;
                  const y1 = from.position.y + 35;
                  const x2 = to.position.x;
                  const y2 = to.position.y + 35;
                  return (
                    <path
                      d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
                      key={`${edge.from}-${edge.to}`}
                    />
                  );
                })}
              </svg>
              {workflow.graph.nodes.map((node) => (
                <div
                  className="workflow-node draggable"
                  key={node.id}
                  onPointerDown={(event) => moveNode(node.id, event)}
                  style={{ left: node.position.x, top: node.position.y }}
                >
                  <span>{node.type}</span>
                  <strong>{node.id}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Runs</h3>
            {runs.map((run) => (
              <div className="list-row" key={run.id}>
                <div>
                  <strong>{run.status}</strong>
                  <span>{run.id}</span>
                </div>
                <code>{JSON.stringify(run.output ?? {})}</code>
              </div>
            ))}
            {!runs.length && <div className="empty-state">No runs yet.</div>}
          </div>
        </div>
        {message && <div className="toast">{message}</div>}
      </section>
    </main>
  );
}
