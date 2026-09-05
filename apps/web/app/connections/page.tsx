'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';
import { useDialog } from '../components/prompt-dialog';
import { useToast } from '../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Connection = {
  id: string;
  name: string;
  provider: string;
  createdAt: string;
  usedInColumns: number;
  createdBy: { name: string; email: string };
};
type Provider = {
  id: string;
  name: string;
  auth: { fields: { key: string; label: string; secret?: boolean; optional?: boolean }[] };
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('mock');
  const [name, setName] = useState('Mock connection');
  const [credentials, setCredentials] = useState<Record<string, string>>({
    apiKey: 'demo-mock-key',
  });
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const { toast } = useToast();
  const dialog = useDialog();

  async function load(): Promise<void> {
    const [connectionsResponse, providersResponse] = await Promise.all([
      fetch(`${api}/connections`, { headers }),
      fetch(`${api}/connections/catalog`, { headers }),
    ]);
    setConnections((await connectionsResponse.json()) as Connection[]);
    setProviders((await providersResponse.json()) as Provider[]);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(): Promise<void> {
    const selected = providers.find((item) => item.id === provider);
    const fields = selected?.auth.fields ?? [];
    const bodyCredentials = Object.fromEntries(
      fields
        .filter((field) => credentials[field.key] || !field.optional)
        .map((field) => [field.key, credentials[field.key] ?? '']),
    );
    await fetch(`${api}/connections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, name, credentials: bodyCredentials }),
    });
    setOpen(false);
    await load();
  }

  async function remove(id: string): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete connection?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    await fetch(`${api}/connections/${id}`, { method: 'DELETE', headers });
    await load();
  }

  async function test(id: string): Promise<void> {
    const response = await fetch(`${api}/connections/${id}/test`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    });
    toast(
      response.ok ? 'Connection test passed' : 'Connection test failed',
      response.ok ? undefined : { kind: 'error' },
    );
  }

  return (
    <main className="app-shell">
      <AppNav />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Connections</h2>
          </div>
          <button className="button primary" onClick={() => setOpen(true)}>
            ＋ Add connection
          </button>
        </header>
        <div className="table-list">
          {connections.map((connection) => (
            <div className="table-card" key={connection.id}>
              <div className="table-icon">⌁</div>
              <div>
                <h3>{connection.name}</h3>
                <p>
                  {connection.provider} · {connection.createdBy?.name ?? 'Workspace'} · used in{' '}
                  {connection.usedInColumns} columns
                </p>
              </div>
              <button className="button" onClick={() => void test(connection.id)}>
                Test
              </button>
              <button className="icon-button danger" onClick={() => void remove(connection.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
      {open && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Add connection</h3>
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value;
                  setProvider(nextProvider);
                  setCredentials(nextProvider === 'mock' ? { apiKey: 'demo-mock-key' } : {});
                }}
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {(providers.find((item) => item.id === provider)?.auth.fields ?? []).map((field) => (
              <label key={field.key}>
                {field.label}
                {field.optional && !/\boptional\b/i.test(field.label) && (
                  <span className="muted"> (optional)</span>
                )}
                <input
                  type={field.secret === false ? 'text' : 'password'}
                  value={credentials[field.key] ?? ''}
                  onChange={(event) =>
                    setCredentials((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
                {field.key === 'tavilyApiKey' && (
                  <span className="muted">
                    Enables web search for agents; falls back to DuckDuckGo/Bing
                  </span>
                )}
              </label>
            ))}
            <div className="modal-actions">
              <button className="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void create()}>
                Save and test
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
