'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';
import { useDialog } from '../components/prompt-dialog';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Definition = {
  id: string;
  name: string;
  type: string;
  config?: { schedule?: string; sourceTableId?: string; alertChannelId?: string };
  _count: { events: number };
};
type SignalEvent = {
  id: string;
  occurredAt: string;
  payload: unknown;
  contact?: { email?: string | null };
  company?: { name?: string };
};
type TableRef = { id: string; name: string };
type Channel = { id: string; url: string; enabled: boolean };

export default function SignalsPage() {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const dialog = useDialog();
  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [definitionResponse, eventResponse, tableResponse, channelResponse] = await Promise.all([
      fetch(`${api}/signals/definitions`, { headers }),
      fetch(`${api}/signals/events`, { headers }),
      fetch(`${api}/tables`, { headers }),
      fetch(`${api}/usage/channels`, { headers }),
    ]);
    setDefinitions((await definitionResponse.json()) as Definition[]);
    setEvents((await eventResponse.json()) as SignalEvent[]);
    setTables((await tableResponse.json()) as TableRef[]);
    setChannels((await channelResponse.json()) as Channel[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const values = await dialog.prompt({
      title: 'New signal',
      description: 'Monitor contacts or companies — from the whole workspace or one table.',
      fields: [
        { name: 'name', label: 'Signal name', defaultValue: 'Funding monitor' },
        {
          name: 'type',
          label: 'Signal type',
          type: 'select',
          defaultValue: 'funding',
          options: [
            { value: 'funding', label: 'Funding / news' },
            { value: 'job_change', label: 'Job change' },
            { value: 'new_hire', label: 'New hire' },
            { value: 'website_visit', label: 'Website visit' },
            { value: 'custom', label: 'Custom' },
          ],
        },
        {
          name: 'tableId',
          label: 'Watch table',
          type: 'select',
          defaultValue: '',
          options: [
            { value: '', label: 'Whole workspace' },
            ...tables.map((table) => ({ value: table.id, label: table.name })),
          ],
        },
        {
          name: 'schedule',
          label: 'Check frequency',
          type: 'select',
          defaultValue: 'daily',
          options: [
            { value: 'hourly', label: 'Hourly' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ],
        },
        {
          name: 'channelId',
          label: 'Alert channel',
          type: 'select',
          defaultValue: '',
          options: [
            { value: '', label: 'None' },
            ...channels.map((channel) => ({ value: channel.id, label: channel.url })),
          ],
        },
      ],
      confirmLabel: 'Create signal',
    });
    if (!values?.name) return;
    await fetch(`${api}/signals/definitions`, {
      method: 'POST',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        type: values.type || 'job_change',
        config: {
          provider: 'mock',
          schedule: values.schedule || 'daily',
          ...(values.tableId ? { sourceTableId: values.tableId } : {}),
          ...(values.channelId ? { alertChannelId: values.channelId } : {}),
        },
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
                    {definition.config?.schedule ? ` · ${definition.config.schedule}` : ''}
                    {definition.config?.sourceTableId ? ' · table-scoped' : ''}
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
