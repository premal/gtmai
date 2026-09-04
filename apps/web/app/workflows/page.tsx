'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Workflow = {
  id: string;
  name: string;
  graph: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number } }>;
    edges: Array<{ from: string; to: string }>;
  };
  _count: { runs: number };
};

export default function WorkflowsPage() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<unknown[]>([]);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const response = await fetch(`${api}/workflows`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as Workflow[];
    setItems(data);
    setSelected((current) => current ?? data[0] ?? null);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  useEffect(() => {
    if (!selected) return;
    void fetch(`${api}/workflows/${selected.id}/runs`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then(setRuns);
  }, [selected, token]);
  async function create() {
    const response = await fetch(`${api}/workflows`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'New workflow',
        graph: {
          nodes: [
            { id: 'trigger', type: 'trigger.manual', config: {}, position: { x: 40, y: 100 } },
          ],
          edges: [],
        },
      }),
    });
    const created = (await response.json()) as Workflow;
    setItems((current) => [...current, created]);
    setSelected(created);
  }
  async function run() {
    if (!selected) return;
    await fetch(`${api}/workflows/${selected.id}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    setRuns((current) => current);
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="workflows" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">OPEN BETA</div>
            <h2>Workflows</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            ＋ New workflow
          </button>
        </header>
        <div className="workflow-layout">
          <div className="panel workflow-list">
            {items.map((item) => (
              <div key={item.id}>
                <button
                  className={selected?.id === item.id ? 'workflow-item active' : 'workflow-item'}
                  onClick={() => setSelected(item)}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.graph.nodes.length} nodes · {item._count.runs} runs
                  </span>
                </button>
                <a className="workflow-open" href={`/workflows/${item.id}`}>
                  Open editor →
                </a>
              </div>
            ))}
          </div>
          {selected ? (
            <div className="panel workflow-canvas">
              <div className="canvas-toolbar">
                <strong>{selected.name}</strong>
                <button className="button primary" onClick={() => void run()}>
                  ▶ Run
                </button>
              </div>
              <div className="canvas-surface">
                {selected.graph.edges.map((edge) => (
                  <div className="edge-label" key={`${edge.from}-${edge.to}`}>
                    {edge.from} → {edge.to}
                  </div>
                ))}
                {selected.graph.nodes.map((node) => (
                  <div
                    className="workflow-node"
                    style={{ left: node.position.x, top: node.position.y }}
                    key={node.id}
                  >
                    <span>{node.type}</span>
                    <strong>{node.id}</strong>
                  </div>
                ))}
              </div>
              <div className="run-list">
                <h3>Runs</h3>
                {runs.map((run, index) => (
                  <pre key={index}>{JSON.stringify(run, null, 2)}</pre>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">Create a workflow to start.</div>
          )}
        </div>
      </section>
    </main>
  );
}
