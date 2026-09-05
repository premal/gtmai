'use client';

import { useEffect, useMemo, useState } from 'react';
import { renderSequenceTemplate } from '@gtmai/shared';
import { AppNav } from '../app-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const sampleContact = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@analytical.engine',
  data: { title: 'Founder' },
};
const sampleCompany = { name: 'Analytical Engines', domain: 'analytical.engine' };
type Step = {
  id?: string;
  position: number;
  delayHours: number;
  subjectTemplate: string;
  bodyTemplate: string;
};
type Sequence = { id: string; name: string; steps: Step[]; _count?: { campaigns: number } };

export default function SequencesPage() {
  const [items, setItems] = useState<Sequence[]>([]);
  const [selected, setSelected] = useState<Sequence | null>(null);
  const [message, setMessage] = useState('');
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const response = await fetch(`${api}/sequences`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as Sequence[];
    setItems(data);
    setSelected((current) =>
      current ? (data.find((item) => item.id === current.id) ?? current) : (data[0] ?? null),
    );
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
  function updateSelected(mutator: (sequence: Sequence) => Sequence) {
    setSelected((current) => (current ? mutator(current) : current));
  }
  function updateStep(index: number, patch: Partial<Step>) {
    updateSelected((sequence) => ({
      ...sequence,
      steps: sequence.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    }));
  }
  function addStep() {
    updateSelected((sequence) => ({
      ...sequence,
      steps: [
        ...sequence.steps,
        {
          position: sequence.steps.length + 1,
          delayHours: 24,
          subjectTemplate: 'Following up, {{contact.firstName}}',
          bodyTemplate:
            'Hi {{contact.firstName}}, I wanted to follow up about {{contact.data.title}}.',
        },
      ],
    }));
  }
  function removeStep(index: number) {
    updateSelected((sequence) => ({
      ...sequence,
      steps: sequence.steps
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step, position) => ({ ...step, position: position + 1 })),
    }));
  }
  function moveStep(index: number, direction: -1 | 1) {
    updateSelected((sequence) => {
      const next = [...sequence.steps];
      const target = index + direction;
      if (target < 0 || target >= next.length) return sequence;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return {
        ...sequence,
        steps: next.map((step, position) => ({ ...step, position: position + 1 })),
      };
    });
  }
  async function save() {
    if (!selected) return;
    const response = await fetch(`${api}/sequences/${selected.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: selected.name, steps: selected.steps }),
    });
    setMessage(response.ok ? 'Sequence saved' : 'Unable to save sequence');
    if (response.ok) await load();
  }
  const preview = useMemo(() => {
    const step = selected?.steps[0];
    return step
      ? {
          subject: renderSequenceTemplate(step.subjectTemplate, sampleContact, sampleCompany),
          body: renderSequenceTemplate(step.bodyTemplate, sampleContact, sampleCompany),
        }
      : null;
  }, [selected]);
  return (
    <main className="app-shell">
      <AppNav active="sequences" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">OUTBOUND</div>
            <h2>Sequences</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            + New sequence
          </button>
        </header>
        <div className="split-grid">
          <div className="panel page-stack">
            {items.map((item) => (
              <button className="table-card-link" key={item.id} onClick={() => setSelected(item)}>
                <strong>{item.name}</strong>
                <span className="muted">
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
                  onChange={(event) =>
                    updateSelected((sequence) => ({ ...sequence, name: event.target.value }))
                  }
                />
                <div className="step-list">
                  {selected.steps.map((step, index) => (
                    <div
                      className="card sequence-step-card"
                      key={step.id ?? `${step.position}-${index}`}
                    >
                      <div className="list-row">
                        <strong>Step {index + 1}</strong>
                        <span className="chip">Position {step.position}</span>
                        <button
                          className="button"
                          disabled={index === 0}
                          onClick={() => moveStep(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="button"
                          disabled={index === selected.steps.length - 1}
                          onClick={() => moveStep(index, 1)}
                        >
                          ↓
                        </button>
                        <button className="button" onClick={() => removeStep(index)}>
                          Remove
                        </button>
                      </div>
                      <label>
                        Delay hours
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={step.delayHours}
                          onChange={(event) =>
                            updateStep(index, { delayHours: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        Subject
                        <input
                          className="input"
                          value={step.subjectTemplate}
                          onChange={(event) =>
                            updateStep(index, { subjectTemplate: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Body
                        <textarea
                          className="input"
                          rows={4}
                          value={step.bodyTemplate}
                          onChange={(event) =>
                            updateStep(index, { bodyTemplate: event.target.value })
                          }
                        />
                      </label>
                      <div className="preview-card">
                        <small>Sample preview · Ada Lovelace · Analytical Engines</small>
                        <strong>
                          {renderSequenceTemplate(
                            step.subjectTemplate,
                            sampleContact,
                            sampleCompany,
                          )}
                        </strong>
                        <p>
                          {renderSequenceTemplate(step.bodyTemplate, sampleContact, sampleCompany)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="button" onClick={addStep}>
                    + Add step
                  </button>
                  <button className="button primary" onClick={() => void save()}>
                    Save sequence
                  </button>
                </div>
                {preview && (
                  <div className="preview-card">
                    <small>Live selected-step preview</small>
                    <strong>{preview.subject}</strong>
                    <p>{preview.body}</p>
                  </div>
                )}
              </>
            ) : (
              <p>Select a sequence to edit steps and preview templates.</p>
            )}
          </div>
        </div>
        {message && <div className="toast">{message}</div>}
      </section>
    </main>
  );
}
