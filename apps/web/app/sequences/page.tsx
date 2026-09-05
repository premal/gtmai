'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Step = {
  id?: string;
  position: number;
  delayHours: number;
  subjectTemplate: string;
  bodyTemplate: string;
};
type Sequence = {
  id: string;
  name: string;
  steps: Step[];
  inbox?: { name: string; config: Record<string, unknown> } | null;
  _count?: { campaigns: number };
};

export default function SequencesPage() {
  const [items, setItems] = useState<Sequence[]>([]);
  const [selected, setSelected] = useState<Sequence | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const response = await fetch(`${api}/sequences`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as Sequence[];
    setItems(data);
    if (selected) setSelected(data.find((item) => item.id === selected.id) ?? null);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const name = window.prompt('Sequence name', 'New outbound sequence');
    if (!name) return;
    await fetch(`${api}/sequences`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        steps: [
          {
            position: 1,
            delayHours: 0,
            subjectTemplate: 'Hello {{contact.firstName}}',
            bodyTemplate: 'Hi {{contact.firstName}} — {{company.name}}',
          },
        ],
      }),
    });
    await load();
  }
  async function save() {
    if (!selected) return;
    await fetch(`${api}/sequences/${selected.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: selected.name, steps: selected.steps }),
    });
    await load();
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="sequences" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">OUTBOUND</div>
            <h2>Sequences</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            + New sequence
          </button>
        </header>
        <div className="split-layout">
          <div className="table-list">
            {items.map((item) => (
              <button className="table-card" key={item.id} onClick={() => setSelected(item)}>
                <strong>{item.name}</strong>
                <span>
                  {item.steps.length} steps · {item._count?.campaigns ?? 0} campaigns
                </span>
              </button>
            ))}
          </div>
          <div className="panel">
            {selected ? (
              <>
                <input
                  className="input"
                  value={selected.name}
                  onChange={(event) => setSelected({ ...selected, name: event.target.value })}
                />
                <div className="step-list">
                  {selected.steps.map((step, index) => (
                    <div className="panel" key={step.id ?? step.position}>
                      <strong>Step {index + 1}</strong>
                      <label>
                        Delay hours
                        <input
                          className="input"
                          type="number"
                          value={step.delayHours}
                          onChange={(event) =>
                            setSelected({
                              ...selected,
                              steps: selected.steps.map((item) =>
                                item === step
                                  ? { ...item, delayHours: Number(event.target.value) }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Subject
                        <input
                          className="input"
                          value={step.subjectTemplate}
                          onChange={(event) =>
                            setSelected({
                              ...selected,
                              steps: selected.steps.map((item) =>
                                item === step
                                  ? { ...item, subjectTemplate: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Body
                        <textarea
                          className="input"
                          value={step.bodyTemplate}
                          onChange={(event) =>
                            setSelected({
                              ...selected,
                              steps: selected.steps.map((item) =>
                                item === step
                                  ? { ...item, bodyTemplate: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <small>Preview: Hello Ada at Analytical Engines</small>
                    </div>
                  ))}
                </div>
                <button className="button primary" onClick={() => void save()}>
                  Save sequence
                </button>
              </>
            ) : (
              <p>Select a sequence to edit steps and preview templates.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
