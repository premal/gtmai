'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';
import { WorkflowEditor, type EditorGraph } from '../../components/workflow-editor';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type FunctionItem = {
  id: string;
  name: string;
  versions: Array<{
    version: number;
    program?: EditorGraph & { inputs?: Array<{ name: string; type: string }>; output?: string };
    testCases?: Array<{ input: Record<string, unknown>; expected: unknown }>;
  }>;
};
type TestResult = {
  input: Record<string, unknown>;
  expected: unknown;
  output: unknown;
  pass: boolean;
};

export default function FunctionsPage() {
  const [items, setItems] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState<FunctionItem | null>(null);
  const [graph, setGraph] = useState<EditorGraph>({ nodes: [], edges: [] });
  const [inputs, setInputs] = useState([{ name: 'name', type: 'text' }]);
  const [output, setOutput] = useState('{{name}}');
  const [cases, setCases] = useState([
    { input: '{"name":"Acme"}', expected: 'Acme' },
    { input: '{"name":"Globex"}', expected: 'Globex' },
  ]);
  const [results, setResults] = useState<TestResult[]>([]);
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
  function select(item: FunctionItem) {
    setSelected(item);
    const program = item.versions[0]?.program;
    setGraph({
      nodes: (program?.nodes ?? []) as EditorGraph['nodes'],
      edges: (program as { edges?: EditorGraph['edges'] } | undefined)?.edges ?? [],
    });
    setInputs(program?.inputs ?? [{ name: 'name', type: 'text' }]);
    setOutput(program?.output ?? '{{name}}');
    if (item.versions[0]?.testCases)
      setCases(
        item.versions[0].testCases.map((testCase) => ({
          input: JSON.stringify(testCase.input),
          expected: String(testCase.expected),
        })),
      );
  }
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
  async function publish() {
    if (!selected) return;
    await fetch(`${api}/functions/${selected.id}/versions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        program: { inputs, nodes: graph.nodes, edges: graph.edges, output },
        testCases: cases.map((testCase) => ({
          input: JSON.parse(testCase.input),
          expected: testCase.expected,
        })),
      }),
    });
    await load();
  }
  async function runTests() {
    if (!selected) return;
    const response = await fetch(`${api}/functions/${selected.id}/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    setResults(((await response.json()) as { results: TestResult[] }).results ?? []);
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
                <span>{item.versions[0] ? `v${item.versions[0].version}` : 'Draft'}</span>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="panel">
              <div className="canvas-toolbar">
                <h3>{selected.name}</h3>
                <div className="button-row">
                  <button className="button" onClick={() => void runTests()}>
                    Run tests
                  </button>
                  <button className="button primary" onClick={() => void publish()}>
                    Publish version
                  </button>
                </div>
              </div>
              <div className="builder-form">
                <h4>Inputs declaration</h4>
                {inputs.map((input, index) => (
                  <div className="button-row" key={`${input.name}-${index}`}>
                    <input
                      value={input.name}
                      onChange={(event) =>
                        setInputs(
                          inputs.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      value={input.type}
                      onChange={(event) =>
                        setInputs(
                          inputs.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, type: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <button
                  className="button"
                  onClick={() =>
                    setInputs([...inputs, { name: `input${inputs.length + 1}`, type: 'text' }])
                  }
                >
                  Add input
                </button>
                <label className="field-label">
                  Output binding
                  <input value={output} onChange={(event) => setOutput(event.target.value)} />
                </label>
              </div>
              <WorkflowEditor graph={graph} onChange={setGraph} />
              <div className="panel">
                <h3>Test cases</h3>
                {cases.map((testCase, index) => (
                  <div className="test-case" key={index}>
                    <textarea
                      value={testCase.input}
                      onChange={(event) =>
                        setCases(
                          cases.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, input: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      value={testCase.expected}
                      onChange={(event) =>
                        setCases(
                          cases.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, expected: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <button
                  className="button"
                  onClick={() => setCases([...cases, { input: '{}', expected: '' }])}
                >
                  Add test case
                </button>
                {results.map((result, index) => (
                  <div className={result.pass ? 'success-text' : 'error-text'} key={index}>
                    {result.pass ? 'PASS' : 'FAIL'} · actual {JSON.stringify(result.output)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel empty-state">
              Select a function to edit its versioned program.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
