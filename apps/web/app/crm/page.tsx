'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Job = {
  id: string;
  name: string;
  source: { kind: string; id: string };
  destination: {
    provider: string;
    object: string;
    fieldMapping: Record<string, string>;
    upsertKey: string;
  };
  schedule?: string;
  lastStats?: Record<string, number>;
};
type Run = {
  id: string;
  status: string;
  stats?: Record<string, number>;
  startedAt: string;
  completedAt?: string;
  error?: string;
};
type Option = { id: string; name: string; columns?: Array<{ name: string }> };

function statsLabel(stats?: Record<string, number>) {
  if (!stats) return 'No stats';
  return `${stats.synced ?? stats.created ?? 0} synced · ${stats.matched ?? 0} matched · ${stats.skipped ?? 0} skipped`;
}

export default function CrmPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [segments, setSegments] = useState<Option[]>([]);
  const [tables, setTables] = useState<Option[]>([]);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Job | null>(null);
  const [message, setMessage] = useState('');
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };

  async function loadRuns(id: string) {
    const response = await fetch(`${api}/crm/jobs/${id}/runs`, { headers });
    if (response.ok) {
      const data = (await response.json()) as Run[];
      setRuns((current) => ({ ...current, [id]: data }));
    }
  }

  async function load() {
    const workspace = localStorage.getItem('gtmai-workspace');
    const [jobsResponse, segmentResponse, tableResponse] = await Promise.all([
      fetch(`${api}/crm/jobs`, { headers }),
      fetch(`${api}/audiences/segments`, { headers }),
      fetch(`${api}/workspaces/${workspace}/tables`, { headers }),
    ]);
    if (!jobsResponse.ok) {
      setMessage('Unable to load CRM jobs');
      return;
    }
    const nextJobs = (await jobsResponse.json()) as Job[];
    setJobs(nextJobs);
    setSegments((await segmentResponse.json()) as Option[]);
    setTables((await tableResponse.json()) as Option[]);
    await Promise.all(nextJobs.filter((job) => expanded[job.id]).map((job) => loadRuns(job.id)));
  }

  useEffect(() => {
    if (token) void load();
  }, [token]);

  function newJob() {
    setEditing({
      id: '',
      name: '',
      source: { kind: 'segment', id: segments[0]?.id ?? '' },
      destination: {
        provider: 'mock',
        object: 'contact',
        fieldMapping: { email: 'email' },
        upsertKey: 'email',
      },
      schedule: '',
    });
  }

  async function save() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      source: editing.source,
      destination: editing.destination,
      schedule: editing.schedule || undefined,
    };
    const response = await fetch(editing.id ? `${api}/crm/jobs/${editing.id}` : `${api}/crm/jobs`, {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setMessage((await response.text()) || 'Unable to save CRM job');
      return;
    }
    setEditing(null);
    setMessage('CRM job saved');
    await load();
  }

  async function run(id: string) {
    const response = await fetch(`${api}/crm/jobs/${id}/run`, { method: 'POST', headers });
    if (!response.ok) {
      setMessage((await response.text()) || 'Unable to run CRM job');
      return;
    }
    setMessage('CRM run queued');
    setExpanded((current) => ({ ...current, [id]: true }));
    await loadRuns(id);
  }

  function fields(job: Job) {
    return job.source.kind === 'table'
      ? (tables
          .find((table) => table.id === job.source.id)
          ?.columns?.map((column) => column.name) ?? [])
      : ['email', 'firstName', 'lastName', 'companyName', 'domain'];
  }

  async function toggleRuns(id: string) {
    const next = !expanded[id];
    setExpanded((current) => ({ ...current, [id]: next }));
    if (next) await loadRuns(id);
  }

  return (
    <main className="app-shell">
      <Phase2Nav active="crm" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">REVERSE ETL</div>
            <h2>CRM sync</h2>
            <p className="muted">Map audience and table data into your destination systems.</p>
          </div>
          <button className="button primary" onClick={newJob}>
            + New sync job
          </button>
        </header>
        {message && <div className="toast">{message}</div>}
        <div className="page-stack">
          {jobs.map((job) => (
            <article className="card" key={job.id}>
              <div className="card-header">
                <div>
                  <h3>{job.name}</h3>
                  <p className="muted">
                    Source: {job.source.kind} · {job.schedule || 'manual'}
                  </p>
                </div>
                <div className="card-actions">
                  <span className="chip">{job.destination.provider}</span>
                  <span className="chip">{job.destination.object}</span>
                  <button className="button" onClick={() => void run(job.id)}>
                    Run now
                  </button>
                  <button className="button" onClick={() => setEditing(job)}>
                    Edit
                  </button>
                </div>
              </div>
              <p className="muted">{statsLabel(job.lastStats)}</p>
              <button className="button" onClick={() => void toggleRuns(job.id)}>
                {expanded[job.id] ? 'Hide run history' : 'Show run history'}
              </button>
              {expanded[job.id] && (
                <div className="responsive-scroll drawer-section">
                  <div className="table">
                    <div className="table-head">
                      <span>Status</span>
                      <span>Started</span>
                      <span>Completed</span>
                      <span>Stats</span>
                      <span>Error</span>
                    </div>
                    {(runs[job.id] ?? []).map((runItem) => (
                      <div className="table-row" key={runItem.id}>
                        <span className={runItem.status === 'failed' ? 'chip negative' : 'chip'}>
                          {runItem.status}
                        </span>
                        <span className="muted">
                          {new Date(runItem.startedAt).toLocaleString()}
                        </span>
                        <span className="muted">
                          {runItem.completedAt
                            ? new Date(runItem.completedAt).toLocaleString()
                            : 'Running'}
                        </span>
                        <span className="muted">{statsLabel(runItem.stats)}</span>
                        <span className="muted">{runItem.error ?? '—'}</span>
                      </div>
                    ))}
                    {!runs[job.id]?.length && <div className="empty-state">No runs recorded.</div>}
                  </div>
                </div>
              )}
            </article>
          ))}
          {!jobs.length && <div className="panel empty-state">No CRM jobs yet.</div>}
        </div>
        {editing && (
          <div className="modal-backdrop" onClick={() => setEditing(null)}>
            <section className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-header">
                <div>
                  <div className="eyebrow">CRM JOB</div>
                  <h3>{editing.id ? 'Edit sync job' : 'Create sync job'}</h3>
                </div>
                <button className="drawer-close" onClick={() => setEditing(null)}>
                  ×
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    className="input"
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </label>
                <div className="form-grid two">
                  <label>
                    Source kind
                    <select
                      className="input"
                      value={editing.source.kind}
                      onChange={(event) =>
                        setEditing({ ...editing, source: { kind: event.target.value, id: '' } })
                      }
                    >
                      <option value="segment">Segment</option>
                      <option value="table">Table</option>
                    </select>
                  </label>
                  <label>
                    Source
                    <select
                      className="input"
                      value={editing.source.id}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          source: { ...editing.source, id: event.target.value },
                        })
                      }
                    >
                      {(editing.source.kind === 'segment' ? segments : tables).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid two">
                  <label>
                    Destination provider
                    <select
                      className="input"
                      value={editing.destination.provider}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          destination: {
                            ...editing.destination,
                            provider: event.target.value,
                          },
                        })
                      }
                    >
                      <option>mock</option>
                      <option>webhook</option>
                      <option>hubspot</option>
                    </select>
                  </label>
                  <label>
                    Object
                    <select
                      className="input"
                      value={editing.destination.object}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          destination: { ...editing.destination, object: event.target.value },
                        })
                      }
                    >
                      <option>contact</option>
                      <option>company</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid two">
                  <label>
                    Upsert key
                    <input
                      className="input"
                      value={editing.destination.upsertKey}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          destination: {
                            ...editing.destination,
                            upsertKey: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Schedule cron (optional)
                    <input
                      className="input"
                      placeholder="0 * * * *"
                      value={editing.schedule ?? ''}
                      onChange={(event) => setEditing({ ...editing, schedule: event.target.value })}
                    />
                  </label>
                </div>
              </div>
              <div className="drawer-section">
                <div className="card-header">
                  <h4>Field mapping</h4>
                  <button
                    className="button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        destination: {
                          ...editing.destination,
                          fieldMapping: {
                            ...editing.destination.fieldMapping,
                            email: 'email',
                          },
                        },
                      })
                    }
                  >
                    + Mapping
                  </button>
                </div>
                {Object.entries(editing.destination.fieldMapping).map(([source, destination]) => (
                  <div className="form-grid two" key={source}>
                    <select
                      className="input"
                      value={source}
                      onChange={(event) => {
                        const next = { ...editing.destination.fieldMapping };
                        delete next[source];
                        next[event.target.value] = destination;
                        setEditing({
                          ...editing,
                          destination: { ...editing.destination, fieldMapping: next },
                        });
                      }}
                    >
                      {fields(editing).map((field) => (
                        <option key={field}>{field}</option>
                      ))}
                    </select>
                    <div className="card-actions">
                      <input
                        className="input"
                        value={destination}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            destination: {
                              ...editing.destination,
                              fieldMapping: {
                                ...editing.destination.fieldMapping,
                                [source]: event.target.value,
                              },
                            },
                          })
                        }
                      />
                      <button
                        className="button"
                        onClick={() => {
                          const next = { ...editing.destination.fieldMapping };
                          delete next[source];
                          setEditing({
                            ...editing,
                            destination: { ...editing.destination, fieldMapping: next },
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button className="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => void save()}>
                  Save job
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
