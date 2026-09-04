'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type FunctionItem = {
  id: string;
  name: string;
  versions: Array<{ version: number; program?: { output?: string }; testCases?: unknown[] }>;
};

export default function FunctionsPage() {
  const [items, setItems] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState<FunctionItem | null>(null);
  const [output, setOutput] = useState('{{name}}');
  const [testInput, setTestInput] = useState('{"name":"Acme"}');
  const [message, setMessage] = useState('');
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');

  async function load() {
    const response = await fetch(`${api}/functions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setItems((await response.json()) as FunctionItem[]);
  }

  useEffect(() => {
    if (token) void load();
  }, [token]);

  async function create() {
    const name = window.prompt('Function name', 'Normalize company name');
    if (!name) return;
    await fetch(`${api}/functions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await load();
  }

  function select(item: FunctionItem) {
    setSelected(item);
    setOutput(item.versions[0]?.program?.output ?? '{{name}}');
  }

  async function publish() {
    if (!selected) return;
    const parsedInput = JSON.parse(testInput) as { name?: string };
    await fetch(`${api}/functions/${selected.id}/versions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        program: { inputs: [{ name: 'name', type: 'text' }], nodes: [], output },
        testCases: [
          { input: parsedInput, expected: output.replace('{{name}}', parsedInput.name ?? '') },
        ],
      }),
    });
    setMessage('Published function version');
    await load();
  }

  async function runTests() {
    if (!selected) return;
    const response = await fetch(`${api}/functions/${selected.id}/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const result = (await response.json()) as { passed?: boolean };
    setMessage(result.passed ? 'All test cases passed' : 'A test case failed');
  }

  return (
    <main className="app-shell">
      <Phase2Nav active="functions" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">REUSABLE LOGIC</div>
            <h2>Functions</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            ＋ New function
          </button>
        </header>
        <div className="split-grid">
          <div className="panel">
            <h3>Library</h3>
            {items.map((item) => (
              <button
                className={selected?.id === item.id ? 'workflow-item active' : 'workflow-item'}
                key={item.id}
                onClick={() => select(item)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.versions[0]
                    ? `v${item.versions[0].version} · ${item.versions[0].testCases?.length ?? 0} test cases`
                    : 'Draft'}
                </span>
              </button>
            ))}
            {!items.length && (
              <div className="empty-state">Create a reusable function to begin.</div>
            )}
          </div>
          {selected ? (
            <div className="panel">
              <div className="canvas-toolbar">
                <h3>{selected.name}</h3>
                <div className="button-row">
                  <button className="button" onClick={() => void runTests()}>
                    Test
                  </button>
                  <button className="button primary" onClick={() => void publish()}>
                    Publish version
                  </button>
                </div>
              </div>
              <label className="field-label">
                Input declaration
                <input value="name · text" readOnly />
              </label>
              <label className="field-label">
                Output binding
                <input value={output} onChange={(event) => setOutput(event.target.value)} />
              </label>
              <label className="field-label">
                Test case input JSON
                <textarea
                  value={testInput}
                  onChange={(event) => setTestInput(event.target.value)}
                />
              </label>
              <div className="canvas-surface function-canvas">
                <div className="workflow-node" style={{ left: 80, top: 90 }}>
                  <span>input</span>
                  <strong>name</strong>
                </div>
                <div className="workflow-node" style={{ left: 300, top: 90 }}>
                  <span>output</span>
                  <strong>{output}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel empty-state">
              Select a function to edit its versioned program.
            </div>
          )}
        </div>
        {message && <div className="toast">{message}</div>}
      </section>
    </main>
  );
}
