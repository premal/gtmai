'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Definition = { id: string; name: string; type: string; _count: { events: number } };
type SignalEvent = {
  id: string;
  occurredAt: string;
  payload: unknown;
  contact?: { email?: string | null };
  company?: { name?: string };
};

export default function SignalsPage() {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [definitionResponse, eventResponse] = await Promise.all([
      fetch(`${api}/signals/definitions`, { headers }),
      fetch(`${api}/signals/events`, { headers }),
    ]);
    setDefinitions((await definitionResponse.json()) as Definition[]);
    setEvents((await eventResponse.json()) as SignalEvent[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const name = window.prompt('Signal name', 'Job changes');
    if (!name) return;
    await fetch(`${api}/signals/definitions`, {
      method: 'POST',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        type: 'job_change',
        config: { provider: 'mock', action: 'mock.jobChanges', schedule: 'daily' },
      }),
    });
    void load();
  }
  async function poll(definition: Definition) {
    setPollingId(definition.id);
    try {
      const response = await fetch(`${api}/signals/definitions/${definition.id}/poll`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Poll failed');
      await load();
    } finally {
      setPollingId(null);
    }
  }
  return (
    <main className="app-shell">
      <AppNav active="signals" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">AUTOMATION</div>
            <h2>Signals</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            ＋ New signal
          </button>
        </header>
        <div className="split-grid">
          <div className="panel">
            <h3>Definitions</h3>
            {definitions.map((definition) => (
              <div className="list-row" key={definition.id}>
                <div>
                  <strong>{definition.name}</strong>
                  <span>
                    {definition.type} · {definition._count.events} events
                  </span>
                </div>
                <button
                  className="button"
                  disabled={pollingId === definition.id}
                  onClick={() => void poll(definition)}
                >
                  {pollingId === definition.id ? 'Polling…' : 'Poll now'}
                </button>
              </div>
            ))}
            {!definitions.length && <div className="empty-state">No signal definitions yet.</div>}
          </div>
          <div className="panel">
            <h3>Recent events</h3>
            {events.map((event) => (
              <div className="list-row" key={event.id}>
                <div>
                  <strong>{event.contact?.email ?? event.company?.name ?? 'Audience event'}</strong>
                  <span>{new Date(event.occurredAt).toLocaleString()}</span>
                </div>
                <code>{JSON.stringify(event.payload)}</code>
              </div>
            ))}
            {!events.length && <div className="empty-state">No events yet.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}
