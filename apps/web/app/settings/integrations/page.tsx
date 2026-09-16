'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../../app-nav';
import { isAdminRole, useMe } from '../../auth';
import { useDialog } from '../../components/prompt-dialog';
import { useToast } from '../../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Integration = {
  id: string;
  name: string;
  provider: string;
  createdAt: string;
  isDefault: boolean;
  usedInColumns: number;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestMessage?: string | null;
  createdBy: { name: string; email: string };
};
type Provider = {
  id: string;
  name: string;
  auth: { fields: { key: string; label: string; secret?: boolean; optional?: boolean }[] };
  actions?: { id: string; name: string }[];
};
const providerVisuals: Record<string, { initials: string; bg: string; fg: string }> = {
  mock: { initials: 'M', bg: '#e7e5e4', fg: '#57534e' },
  hunter: { initials: 'H', bg: '#ffedd5', fg: '#c2410c' },
  prospeo: { initials: 'P', bg: '#e0f2fe', fg: '#0369a1' },
  datagma: { initials: 'D', bg: '#ede9fe', fg: '#6d28d9' },
  apollo: { initials: 'A', bg: '#dbeafe', fg: '#1d4ed8' },
  peopledatalabs: { initials: 'PD', bg: '#ccfbf1', fg: '#0f766e' },
  theirstack: { initials: 'TS', bg: '#d1fae5', fg: '#047857' },
  hginsights: { initials: 'HG', bg: '#ffe4e6', fg: '#be123c' },
  http: { initials: '⌁', bg: '#e7e5e4', fg: '#57534e' },
  llm: { initials: 'AI', bg: '#f3e8ff', fg: '#7e22ce' },
  smtp: { initials: 'S', bg: '#e7e5e4', fg: '#57534e' },
  meta: { initials: 'M', bg: '#dbeafe', fg: '#1d4ed8' },
  google: { initials: 'G', bg: '#fee2e2', fg: '#b91c1c' },
  linkedin: { initials: 'in', bg: '#dbeafe', fg: '#0a66c2' },
  hubspot: { initials: 'H', bg: '#ffedd5', fg: '#ea580c' },
  salesforce: { initials: 'SF', bg: '#e0f2fe', fg: '#0284c7' },
  webhook: { initials: 'W', bg: '#e7e5e4', fg: '#57534e' },
};
function visualFor(providerId: string, providerName: string) {
  const known = providerVisuals[providerId];
  if (known) return known;
  const initials = providerName
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return { initials: initials || '?', bg: '#e7e5e4', fg: '#57534e' };
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('');
  const [name, setName] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Integration | null>(null);
  const [editName, setEditName] = useState('');
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const { toast } = useToast();
  const dialog = useDialog();
  const me = useMe();
  const admin = isAdminRole(me?.role);

  const providerName = (id: string): string => providers.find((item) => item.id === id)?.name ?? id;

  function openCreate(): void {
    setProvider('');
    setName('');
    setCredentials({});
    setOpen(true);
  }

  async function load(): Promise<void> {
    const [integrationsResponse, providersResponse] = await Promise.all([
      fetch(`${api}/integrations`, { headers }),
      fetch(`${api}/integrations/catalog`, { headers }),
    ]);
    if (!integrationsResponse.ok) {
      toast(await responseMessage(integrationsResponse, 'Unable to load integrations'), {
        kind: 'error',
      });
    } else setIntegrations((await integrationsResponse.json()) as Integration[]);
    if (!providersResponse.ok) {
      toast(await responseMessage(providersResponse, 'Unable to load providers'), {
        kind: 'error',
      });
    } else setProviders((await providersResponse.json()) as Provider[]);
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
    const response = await fetch(`${api}/integrations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider,
        name: name.trim() || providerName(provider),
        credentials: bodyCredentials,
      }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to create integration'), { kind: 'error' });
      return;
    }
    setOpen(false);
    await load();
  }

  function openEdit(integration: Integration): void {
    setEditing(integration);
    setEditName(integration.name);
    setEditCredentials({});
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const updates = Object.fromEntries(
      Object.entries(editCredentials).filter(([, value]) => value !== ''),
    );
    const response = await fetch(`${api}/integrations/${editing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: editName,
        ...(Object.keys(updates).length > 0 ? { credentials: updates } : {}),
      }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to update integration'), { kind: 'error' });
      return;
    }
    setEditing(null);
    await load();
  }

  async function remove(integration: Integration): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete integration?',
      description:
        integration.usedInColumns > 0
          ? `${integration.name} is used in ${integration.usedInColumns} columns — those runs will fail. This cannot be undone.`
          : 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`${api}/integrations/${integration.id}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to delete integration'), { kind: 'error' });
      return;
    }
    await load();
  }

  async function test(id: string): Promise<void> {
    setTestingId(id);
    try {
      const response = await fetch(`${api}/integrations/${id}/test`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      const message =
        body.message ?? (body.ok ? 'Integration test passed' : 'Integration test failed');
      if (response.ok) {
        setIntegrations((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  lastTestAt: new Date().toISOString(),
                  lastTestOk: body.ok ?? false,
                  lastTestMessage: message,
                }
              : item,
          ),
        );
      }
      toast(message, response.ok && body.ok ? undefined : { kind: 'error' });
    } catch {
      toast('Integration test failed — unable to reach the API', { kind: 'error' });
    } finally {
      setTestingId(null);
    }
  }

  const editingFields = providers.find((item) => item.id === editing?.provider)?.auth.fields ?? [];

  return (
    <main className="app-shell">
      <AppNav active="settings">
        <a className="back-link" href="/settings">
          ← Settings
        </a>
      </AppNav>
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">SETTINGS</div>
            <h2>Integrations</h2>
          </div>
          {admin && (
            <button className="button primary" onClick={openCreate}>
              ＋ Add integration
            </button>
          )}
        </header>
        <div className="table-list">
          {integrations.length === 0 && (
            <div className="card empty-state">
              <p>No integrations yet — connect a provider to start enriching rows.</p>
              {admin && (
                <button className="button primary" onClick={openCreate}>
                  ＋ Add integration
                </button>
              )}
            </div>
          )}
          {integrations.map((integration) => {
            const catalogEntry = providers.find((item) => item.id === integration.provider);
            const actionNames = (catalogEntry?.actions ?? []).map((action) => action.name);
            const visual = visualFor(
              integration.provider,
              catalogEntry?.name ?? integration.provider,
            );
            return (
              <div className="table-card" key={integration.id}>
                <div
                  className="table-icon"
                  style={{ background: visual.bg, color: visual.fg, fontWeight: 600 }}
                >
                  {visual.initials}
                </div>
                <div className="integration-info">
                  <h3>
                    {integration.name}{' '}
                    {integration.isDefault && <span className="tag-chip">default</span>}
                  </h3>
                  <p>
                    {providerName(integration.provider)} · added by{' '}
                    {integration.createdBy?.name ?? 'Workspace'}
                    {integration.usedInColumns > 0 &&
                      ` · used in ${integration.usedInColumns} column${integration.usedInColumns === 1 ? '' : 's'}`}
                  </p>
                  {actionNames.length > 0 && (
                    <p className="action-chips">
                      {actionNames.slice(0, 3).map((actionName) => (
                        <span className="tag-chip" key={actionName}>
                          {actionName}
                        </span>
                      ))}
                      {actionNames.length > 3 && (
                        <span className="tag-chip">+{actionNames.length - 3} more</span>
                      )}
                    </p>
                  )}
                  {integration.lastTestAt && (
                    <p className={`integration-status ${integration.lastTestOk ? 'ok' : 'fail'}`}>
                      <span className="status-dot" />
                      {integration.lastTestOk ? 'Verified' : 'Failed'}{' '}
                      {new Date(integration.lastTestAt).toLocaleDateString()}
                      {integration.lastTestMessage ? ` — ${integration.lastTestMessage}` : ''}
                    </p>
                  )}
                </div>
                {admin && (
                  <div className="toolbar">
                    <button
                      className="button"
                      disabled={testingId === integration.id}
                      onClick={() => void test(integration.id)}
                    >
                      {testingId === integration.id ? 'Testing…' : 'Test'}
                    </button>
                    <button className="button" onClick={() => openEdit(integration)}>
                      Edit
                    </button>
                    <button className="icon-button danger" onClick={() => void remove(integration)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {open && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Add integration</h3>
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value;
                  setProvider(nextProvider);
                  setName(providerName(nextProvider));
                  setCredentials({});
                }}
              >
                <option value="" disabled>
                  Choose a provider…
                </option>
                {providers
                  .filter((item) => item.id !== 'mock')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={name}
                placeholder={provider ? providerName(provider) : 'Integration name'}
                onChange={(event) => setName(event.target.value)}
              />
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
              <button className="button primary" disabled={!provider} onClick={() => void create()}>
                Save and test
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Edit integration</h3>
            <label>
              Name
              <input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            {editingFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type={field.secret === false ? 'text' : 'password'}
                  placeholder="Leave blank to keep current"
                  value={editCredentials[field.key] ?? ''}
                  onChange={(event) =>
                    setEditCredentials((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <div className="modal-actions">
              <button className="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
