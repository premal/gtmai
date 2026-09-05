'use client';
import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Job = {
  id: string;
  name: string;
  destination: { provider: string; object: string; upsertKey: string };
  lastRunAt?: string;
  lastStats?: { matched: number; synced: number; skipped: number };
};
export default function CrmPage() {
  const [items, setItems] = useState<Job[]>([]);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const response = await fetch(`${api}/crm/jobs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setItems((await response.json()) as Job[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const name = window.prompt('Sync job name', 'CRM contacts');
    if (!name) return;
    await fetch(`${api}/crm/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        source: { kind: 'segment', id: '' },
        destination: {
          provider: 'mock',
          object: 'contact',
          fieldMapping: { email: 'email', firstname: 'firstName', lastname: 'lastName' },
          upsertKey: 'email',
        },
      }),
    });
    await load();
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="crm" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">REVERSE ETL</div>
            <h2>CRM sync jobs</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            + New sync
          </button>
        </header>
        <div className="table-list">
          {items.map((item) => (
            <div className="table-card" key={item.id}>
              <strong>{item.name}</strong>
              <span>
                {item.destination.provider} · {item.destination.object} · upsert by{' '}
                {item.destination.upsertKey}
              </span>
              <span>
                {item.lastStats
                  ? `${item.lastStats.synced} synced · ${item.lastStats.skipped} skipped`
                  : 'Never run'}
              </span>
              <button
                className="button"
                onClick={() =>
                  void fetch(`${api}/crm/jobs/${item.id}/run`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${token}` },
                  }).then(load)
                }
              >
                Run now
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
