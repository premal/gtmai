'use client';

import { use, useEffect, useState } from 'react';
import { AppNav } from '../../app-nav';
import { WorkflowEditor, type EditorGraph } from '../../../components/workflow-editor';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Workflow = { id: string; name: string; graph: EditorGraph };
type Step = {
  nodeId: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  credits: number;
  durationMs?: number;
};
type Run = { id: string; status: string; output?: unknown; steps?: Step[] };

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] }>({
    errors: [],
    warnings: [],
  });
  const [dirty, setDirty] = useState(false);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');

  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [workflowResponse, runsResponse] = await Promise.all([
      fetch(`${api}/workflows/${id}`, { headers }),
      fetch(`${api}/workflows/${id}/runs`, { headers }),
    ]);
    if (workflowResponse.status === 404) {
      setNotFound(true);
      setWorkflow(null);
    } else if (workflowResponse.ok) {
      setNotFound(false);
      setWorkflow((await workflowResponse.json()) as Workflow);
    }
    if (runsResponse.ok) setRuns((await runsResponse.json()) as Run[]);
  }
  async function loadRuns() {
    const response = await fetch(`${api}/workflows/${id}/runs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) setRuns((await response.json()) as Run[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token, id]);
  useEffect(() => {
    if (!token || !id) return;
    const stream = new EventSource(
      `${api}/workflows/${id}/events?token=${encodeURIComponent(token)}`,
    );
    stream.onmessage = () => {
      void loadRuns();
    };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [token, id]);

  async function validate(): Promise<{ errors: string[]; warnings: string[] }> {
    const response = await fetch(`${api}/workflows/${id}/validate`, {
      method: 'POST',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: JSON.stringify(workflow?.graph),
    });
    const result = response.ok
      ? ((await response.json()) as { errors: string[]; warnings: string[] })
      : { errors: ['Validation request failed'], warnings: [] };
    setValidation(result);
    return result;
  }
  async function save() {
    if (!workflow) return;
    const result = await validate();
    if (result.errors.length) return;
    await fetch(`${api}/workflows/${id}`, {
      method: 'PATCH',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: JSON.stringify({ graph: workflow.graph }),
    });
    setDirty(false);
    setMessage('Workflow saved');
  }
  async function run() {
    if (!workflow) return;
    const input = window.prompt('Run input JSON', '{}');
    if (input === null) return;
    await fetch(`${api}/workflows/${id}/run`, {
      method: 'POST',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: input,
    });
    setMessage('Workflow run queued');
    await load();
  }
  function selectRun(run: Run) {
    setSelectedRun(run);
    setSelectedStep(null);
    setEditMode(false);
    void loadRuns();
    void fetch(`${api}/workflows/runs/${run.id}`, { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? (response.json() as Promise<Run>) : run))
      .then(setSelectedRun);
    const stream = new EventSource(
      `${api}/workflows/runs/${run.id}/events?token=${encodeURIComponent(token)}`,
    );
    stream.onmessage = (event) => {
      let status: string | undefined;
      try {
        status = (JSON.parse(event.data) as { status?: string }).status;
      } catch {
        status = undefined;
      }
      if (status === 'done' || status === 'error') {
        void loadRuns();
        void fetch(`${api}/workflows/runs/${run.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
          .then((response) => (response.ok ? (response.json() as Promise<Run>) : null))
          .then((latest) => {
            if (latest) setSelectedRun(latest);
          });
      } else {
        void load();
      }
    };
    stream.onerror = () => stream.close();
  }
  const statuses = Object.fromEntries(
    (selectedRun?.steps ?? []).map((step) => [step.nodeId, step.status]),
  );
  const nodeTitle = (nodeId: string) => {
    const node = workflow?.graph.nodes.find((item) => item.id === nodeId);
    return typeof node?.config?.label === 'string' ? node.config.label : nodeId;
  };

  if (notFound)
    return (
      <main className="app-shell">
        <AppNav active="workflows" />
        <section className="content empty-state">
          <h2>Workflow not found</h2>
          <a className="button" href="/workflows">
            Back to workflows
          </a>
        </section>
      </main>
    );
  if (!workflow)
    return (
      <main className="app-shell">
        <AppNav active="workflows" />
        <section className="content empty-state">Loading workflow…</section>
      </main>
    );
  return (
    <main className="app-shell">
      <AppNav active="workflows" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKFLOW EDITOR {dirty && '· UNSAVED'}</div>
            <h2>{workflow.name}</h2>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => void validate()}>
              Validate
            </button>
            <button className="button" onClick={() => void save()}>
              Save
            </button>
            <button className="button primary" onClick={() => void run()}>
              ▶ Run
            </button>
          </div>
        </header>
        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div className="validation-panel">
            {validation.errors.map((error) => (
              <div className="error-text" key={error}>
                {error}
              </div>
            ))}
            {validation.warnings.map((warning) => (
              <div className="warning-text" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        )}
        <WorkflowEditor
          graph={workflow.graph}
          statuses={statuses}
          runSelected={Boolean(selectedRun)}
          editMode={editMode}
          onEdit={() => setEditMode(true)}
          onNodeSelect={(nodeId) => {
            const step = selectedRun?.steps?.find((item) => item.nodeId === nodeId);
            if (step) setSelectedStep(step);
          }}
          onChange={(graph) => {
            setWorkflow({ ...workflow, graph });
            setDirty(true);
          }}
        />
        <div className="panel run-panel">
          <div className="canvas-toolbar">
            <h3>Runs</h3>
            <span>{runs.length} recent</span>
          </div>
          {runs.map((run) => (
            <button className="list-row" key={run.id} onClick={() => selectRun(run)}>
              <strong>{run.status}</strong>
              <span>{run.id.slice(0, 18)}</span>
            </button>
          ))}
        </div>
        {selectedRun && (
          <div className="panel step-panel">
            <h3>Run {selectedRun.status}</h3>
            {(selectedRun.steps ?? []).map((step) => (
              <button className="list-row" key={step.nodeId} onClick={() => setSelectedStep(step)}>
                <strong>{nodeTitle(step.nodeId)}</strong>
                <span>
                  {step.status} · {step.credits} credits
                </span>
              </button>
            ))}
          </div>
        )}
        {selectedStep && (
          <aside className="detail-drawer">
            <button
              className="drawer-close"
              onClick={() => setSelectedStep(null)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="eyebrow">STEP DETAIL</div>
            <h3>{nodeTitle(selectedStep.nodeId)}</h3>
            <div className="detail-row">
              <span>Status</span>
              <strong>{selectedStep.status}</strong>
            </div>
            <h4>Input</h4>
            <pre>{JSON.stringify(selectedStep.input ?? {}, null, 2)}</pre>
            <h4>Output</h4>
            <pre>{JSON.stringify(selectedStep.output ?? {}, null, 2)}</pre>
            {selectedStep.error && <div className="error-text">{selectedStep.error}</div>}
            <div className="detail-row">
              <span>Credits</span>
              <strong>{selectedStep.credits}</strong>
            </div>
            <div className="detail-row">
              <span>Duration</span>
              <strong>{selectedStep.durationMs ?? 0}ms</strong>
            </div>
          </aside>
        )}
        {message && <div className="toast">{message}</div>}
      </section>
    </main>
  );
}
