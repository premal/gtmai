'use client';

import { useEffect, useMemo, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type AudienceTab = 'companies' | 'contacts' | 'segments';
type AudienceItem = {
  id: string;
  name?: string;
  domain?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: { name?: string; domain?: string };
  signalEvents?: Array<{
    id: string;
    occurredAt: string;
    payload: unknown;
    definition?: { name?: string; type?: string };
  }>;
  _count?: { contacts?: number; signalEvents?: number; memberships?: number };
};
type FilterRow = { field: string; op: string; value: string };

export default function AudiencesPage() {
  const [tab, setTab] = useState<AudienceTab>('companies');
  const [items, setItems] = useState<AudienceItem[]>([]);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<AudienceItem | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterRow, setFilterRow] = useState<FilterRow>({
    field: 'data.title',
    op: 'contains',
    value: '',
  });
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const filter = useMemo(
    () =>
      filterRow.value
        ? JSON.stringify({ field: filterRow.field, op: filterRow.op, value: filterRow.value })
        : '',
    [filterRow],
  );
  function signalSummary(payload: unknown) {
    if (!payload || typeof payload !== 'object') return 'Signal received';
    const entries = Object.entries(payload as Record<string, unknown>).filter(
      ([key]) => !['hash', 'source'].includes(key),
    );
    return entries.length
      ? entries
          .slice(0, 2)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(' · ')
      : 'Signal received';
  }

  async function load() {
    if (!token) return;
    const params = new URLSearchParams({ q });
    if (filter && tab !== 'segments') params.set('filter', filter);
    const response = await fetch(`${api}/audiences/${tab}?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as { items?: AudienceItem[] } | AudienceItem[];
    setItems(Array.isArray(data) ? data : (data.items ?? []));
  }

  useEffect(() => {
    void load();
  }, [q, tab, filter, token]);

  async function create() {
    const name = window.prompt(
      tab === 'companies' ? 'Company name' : tab === 'contacts' ? 'Contact email' : 'Segment name',
    );
    if (!name) return;
    const payload =
      tab === 'companies'
        ? { name, domain: name.toLowerCase().replace(/\s+/g, '') + '.example.com' }
        : tab === 'contacts'
          ? { email: name }
          : { name, filter: { field: 'data.title', op: 'exists', value: true } };
    await fetch(`${api}/audiences/${tab}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setMessage('Created');
    await load();
  }

  async function importFromTable() {
    const tableId = window.prompt('Table ID to import');
    if (!tableId) return;
    const mapping = window.prompt(
      'Optional mapping JSON',
      '{"email":"Email","firstName":"First name","lastName":"Last name","domain":"Domain"}',
    );
    await fetch(`${api}/audiences/import/table/${tableId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mapping: mapping ? JSON.parse(mapping) : {} }),
    });
    setMessage('Imported into audiences');
    setTab('contacts');
    await load();
  }

  async function refreshSegment(id: string) {
    const response = await fetch(`${api}/audiences/segments/${id}/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const result = (await response.json()) as { count?: number };
    setMessage(`Segment refreshed: ${result.count ?? 0} contacts`);
    await load();
  }

  async function createTableFromSegment(id: string) {
    const name = window.prompt('New table name', 'Segment export');
    if (!name) return;
    const response = await fetch(`${api}/audiences/export/table`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, segmentId: id }),
    });
    const result = (await response.json()) as { tableId?: string };
    setMessage(`Created table ${result.tableId ?? ''}`);
  }

  return (
    <main className="app-shell">
      <Phase2Nav active="audiences" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">DATA LAYER</div>
            <h2>Audiences</h2>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => void importFromTable()}>
              Import from table
            </button>
            <button className="button primary" onClick={() => void create()}>
              ＋ Add
            </button>
          </div>
        </header>
        <div className="tabs">
          {(['companies', 'contacts', 'segments'] as AudienceTab[]).map((value) => (
            <button
              className={tab === value ? 'tab active' : 'tab'}
              key={value}
              onClick={() => setTab(value)}
            >
              {value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="filter-toolbar">
          <input
            className="search-input"
            placeholder="Search name, domain, or email"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <button className="button" onClick={() => setFilterOpen((value) => !value)}>
            {filterOpen ? 'Hide filter' : '＋ Filter'}
          </button>
        </div>
        {filterOpen && (
          <div className="filter-builder panel">
            <select
              value={filterRow.field}
              onChange={(event) => setFilterRow({ ...filterRow, field: event.target.value })}
            >
              <option value="data.title">Title</option>
              <option value="company.domain">Company domain</option>
              <option value="email">Email</option>
            </select>
            <select
              value={filterRow.op}
              onChange={(event) => setFilterRow({ ...filterRow, op: event.target.value })}
            >
              <option value="contains">contains</option>
              <option value="eq">equals</option>
              <option value="exists">exists</option>
              <option value="gte">≥</option>
              <option value="lte">≤</option>
            </select>
            <input
              value={filterRow.value}
              placeholder="Value"
              onChange={(event) => setFilterRow({ ...filterRow, value: event.target.value })}
            />
          </div>
        )}
        <div className="audience-grid">
          <div className="grid-head">
            <span>Name</span>
            <span>Domain / email</span>
            <span>Signals / members</span>
          </div>
          {items.map((item) => (
            <button
              className="grid-row grid-row-button"
              key={item.id}
              onClick={() => setSelected(item)}
            >
              <strong>{item.name ?? `${item.firstName ?? ''} ${item.lastName ?? ''}`}</strong>
              <span>{item.domain ?? item.email ?? item.company?.domain ?? '—'}</span>
              <span>
                {tab === 'segments'
                  ? `${item._count?.memberships ?? 0} members`
                  : tab === 'companies'
                    ? `${item._count?.contacts ?? 0} contacts · ${item._count?.signalEvents ?? 0} signals`
                    : `${item._count?.signalEvents ?? 0} signals`}
              </span>
              {tab === 'segments' && (
                <span className="row-actions">
                  <span role="button" tabIndex={0} onClick={() => void refreshSegment(item.id)}>
                    Refresh
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => void createTableFromSegment(item.id)}
                  >
                    Create table
                  </span>
                </span>
              )}
            </button>
          ))}
          {!items.length && (
            <div className="empty-state">No {tab} yet. Import a table or add one above.</div>
          )}
        </div>
        {selected && (
          <aside className="detail-drawer">
            <button className="drawer-close" onClick={() => setSelected(null)}>
              ×
            </button>
            <div className="eyebrow">AUDIENCE RECORD</div>
            <h3>{selected.name ?? selected.email ?? 'Contact'}</h3>
            <div className="signal-timeline">
              <h4>Signals</h4>
              {selected.signalEvents?.length ? (
                selected.signalEvents.map((event) => (
                  <div className="signal-timeline-item" key={event.id}>
                    <div className="signal-timeline-meta">
                      <span className="chip">{event.definition?.type ?? 'signal'}</span>
                      <time>{new Date(event.occurredAt).toLocaleString()}</time>
                    </div>
                    <strong>{event.definition?.name ?? 'Signal event'}</strong>
                    <span>{signalSummary(event.payload)}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">No signals for this contact.</div>
              )}
            </div>
            <details>
              <summary>Record data</summary>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </details>
          </aside>
        )}
        {message && <div className="toast">{message}</div>}
      </section>
    </main>
  );
}
