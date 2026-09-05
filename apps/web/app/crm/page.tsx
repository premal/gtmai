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
export default function CrmPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [segments, setSegments] = useState<Option[]>([]);
  const [tables, setTables] = useState<Option[]>([]);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [editing, setEditing] = useState<Job | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };
  async function load() {
    const [jobsResponse, segmentResponse, tableResponse] = await Promise.all([
      fetch(`${api}/crm/jobs`, { headers }),
      fetch(`${api}/audiences/segments`, { headers }),
      fetch(`${api}/workspaces/${localStorage.getItem('gtmai-workspace')}/tables`, { headers }),
    ]);
    const nextJobs = (await jobsResponse.json()) as Job[];
    setJobs(nextJobs);
    setSegments((await segmentResponse.json()) as Option[]);
    setTables((await tableResponse.json()) as Option[]);
    await Promise.all(
      nextJobs.map(async (job) => {
        const response = await fetch(`${api}/crm/jobs/${job.id}/runs`, { headers });
        const data = (await response.json()) as Run[];
        setRuns((current) => ({ ...current, [job.id]: data }));
      }),
    );
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
    await fetch(editing.id ? `${api}/crm/jobs/${editing.id}` : `${api}/crm/jobs`, {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setEditing(null);
    await load();
  }
  async function run(id: string) {
    await fetch(`${api}/crm/jobs/${id}/run`, { method: 'POST', headers });
    await load();
  }
  function fields(job: Job) {
    const source =
      job.source.kind === 'table'
        ? (tables
            .find((table) => table.id === job.source.id)
            ?.columns?.map((column) => column.name) ?? [])
        : ['email', 'firstName', 'lastName', 'companyName', 'domain'];
    return source;
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="crm" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">REVERSE ETL</div>
            <h2>CRM sync</h2>
          </div>
          <button className="button primary" onClick={newJob}>
            + New sync job
          </button>
        </header>
        <div className="table-list">
          {jobs.map((job) => (
            <div className="table-card" key={job.id}>
              <div className="list-row">
                <strong>{job.name}</strong>
                <span>
                  {job.destination.provider} · {job.destination.object} · {job.schedule || 'manual'}
                </span>
                <button className="button" onClick={() => void run(job.id)}>
                  Run now
                </button>
                <button className="button" onClick={() => setEditing(job)}>
                  Edit
                </button>
              </div>
              <p>
                Source: {job.source.kind} ·{' '}
                {job.lastStats ? JSON.stringify(job.lastStats) : 'No runs yet'}
              </p>
              <h4>Run history</h4>
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Stats</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs[job.id] ?? []).map((runItem) => (
                    <tr key={runItem.id}>
                      <td>
                        {runItem.status}
                        {runItem.error ? `: ${runItem.error}` : ''}
                      </td>
                      <td>{new Date(runItem.startedAt).toLocaleString()}</td>
                      <td>
                        {runItem.completedAt ? new Date(runItem.completedAt).toLocaleString() : '—'}
                      </td>
                      <td>{runItem.stats ? JSON.stringify(runItem.stats) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        {editing && (
          <div className="modal-backdrop" onClick={() => setEditing(null)}>
            <section className="modal" onClick={(event) => event.stopPropagation()}>
              <h3>{editing.id ? 'Edit sync job' : 'Create sync job'}</h3>
              <label>
                Name
                <input
                  className="input"
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </label>
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
              <label>
                Destination provider
                <select
                  className="input"
                  value={editing.destination.provider}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      destination: { ...editing.destination, provider: event.target.value },
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
              <label>
                Upsert key
                <input
                  className="input"
                  value={editing.destination.upsertKey}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      destination: { ...editing.destination, upsertKey: event.target.value },
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
              <h4>Field mapping</h4>
              {Object.entries(editing.destination.fieldMapping).map(([source, destination]) => (
                <div className="list-row" key={source}>
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
              ))}
              <button
                className="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    destination: {
                      ...editing.destination,
                      fieldMapping: { ...editing.destination.fieldMapping, email: 'email' },
                    },
                  })
                }
              >
                + Mapping
              </button>
              <div className="modal-actions">
                <button className="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => void save()}>
                  Save
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
