'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../app-nav';
import { useDialog } from '../components/prompt-dialog';
import { useToast } from '../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Account = {
  id: string;
  name: string;
  domain?: string;
  linkedinUrl?: string;
  industry?: string;
  size?: string;
  employees?: number;
  revenueUsdM?: number;
  city?: string;
  state?: string;
  country?: string;
  founded?: number;
  ticker?: string;
};
type Facet = { value: string; count: number };
type Facets = { total: number; industries: Facet[]; states: Facet[]; sizes: Facet[] };
type Table = { id: string; name: string };

const SIZE_ORDER = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5001-10000',
  '10001+',
];

const fmt = (n?: number) => (n === undefined || n === null ? '—' : n.toLocaleString());
const fmtM = (n?: number) => (n === undefined || n === null ? '—' : `$${n.toLocaleString()}M`);

export default function AccountsPage() {
  const [items, setItems] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [state, setState] = useState('');
  const [size, setSize] = useState('');
  const [minRevenue, setMinRevenue] = useState('');
  const [maxRevenue, setMaxRevenue] = useState('');
  const [minEmployees, setMinEmployees] = useState('');
  const [sort, setSort] = useState('revenueUsdM');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [exporting, setExporting] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const dialog = useDialog();
  const { toast } = useToast();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };

  const filters = {
    q: debouncedQ,
    industry,
    state,
    size,
    minRevenue,
    maxRevenue,
    minEmployees,
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '50', sort, order });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    try {
      const response = await fetch(`${api}/accounts?${params}`, { headers });
      if (response.ok) {
        const data = (await response.json()) as {
          items: Account[];
          total: number;
          pages: number;
        };
        setItems(data.items);
        setTotal(data.total);
        setPages(data.pages);
      }
    } finally {
      setLoading(false);
    }
  }, [
    token,
    page,
    sort,
    order,
    debouncedQ,
    industry,
    state,
    size,
    minRevenue,
    maxRevenue,
    minEmployees,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    void fetch(`${api}/accounts/facets`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setFacets(data as Facets));
    const workspace = localStorage.getItem('gtmai-workspace') ?? '';
    void fetch(`${api}/workspaces/${workspace}/tables`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTables(Array.isArray(data) ? data : []));
  }, [token]);

  function onQ(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setDebouncedQ(value);
      setPage(1);
    }, 300);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((item) => item.id)),
    );
  }

  async function exportAccounts() {
    const picked = items.filter((item) => selected.has(item.id));
    const values = await dialog.prompt({
      title: picked.length
        ? `Add ${picked.length} accounts to a table`
        : 'Add matching accounts to a table',
      description: picked.length
        ? 'Selected accounts become rows; each field becomes an input column.'
        : 'Accounts matching the current filters become rows; each field becomes an input column.',
      fields: [
        {
          name: 'tableId',
          label: 'Target table',
          type: 'select',
          options: [
            { value: '', label: '＋ New table' },
            ...tables.map((table) => ({ value: table.id, label: table.name })),
          ],
        },
        { name: 'name', label: 'New table name (if creating)', defaultValue: 'US accounts' },
        ...(picked.length
          ? []
          : [{ name: 'limit', label: 'Max rows (up to 5000)', defaultValue: '500' }]),
      ],
      confirmLabel: 'Add to table',
    });
    if (!values) return;
    setExporting(true);
    try {
      const body: Record<string, unknown> = {
        tableId: values.tableId || undefined,
        name: values.name || undefined,
      };
      if (picked.length) body.ids = picked.map((item) => item.id);
      else {
        body.filters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
        body.limit = Number(values.limit) || 500;
      }
      const response = await fetch(`${api}/accounts/export`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        toast((await response.text()) || 'Export failed', { kind: 'error' });
        return;
      }
      const data = (await response.json()) as { tableId: string; rows: number };
      toast(`${data.rows} accounts added`, { kind: 'info' });
      window.location.href = `/tables/${data.tableId}`;
    } finally {
      setExporting(false);
    }
  }

  const industries = (facets?.industries ?? []).filter((f) => f.value);
  const states = (facets?.states ?? []).filter((f) => f.value);
  const sizes = SIZE_ORDER.filter((s) => facets?.sizes.some((f) => f.value === s));

  return (
    <main className="app-shell">
      <AppNav active="accounts" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">UNIVERSE</div>
            <h2>Accounts</h2>
            <p className="muted">
              {facets ? `${facets.total.toLocaleString()} US companies` : 'US company universe'} —
              filter, then pull accounts into a table to enrich them.
            </p>
          </div>
          <button
            className="button primary"
            disabled={exporting}
            onClick={() => void exportAccounts()}
          >
            {selected.size ? `Add ${selected.size} selected to table` : 'Add matching to table'}
          </button>
        </header>

        <section className="panel">
          <div className="filter-toolbar">
            <input
              className="search-input"
              placeholder="Search name, domain, LinkedIn, ticker…"
              value={q}
              onChange={(event) => onQ(event.target.value)}
            />
            <select
              className="input"
              value={industry}
              onChange={(e) => {
                setIndustry(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All industries</option>
              {industries.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value} ({f.count.toLocaleString()})
                </option>
              ))}
            </select>
            <select
              className="input"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All states</option>
              {states.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value} ({f.count.toLocaleString()})
                </option>
              ))}
            </select>
            <select
              className="input"
              value={size}
              onChange={(e) => {
                setSize(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All sizes</option>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s} employees
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Min revenue $M"
              style={{ width: 130 }}
              value={minRevenue}
              onChange={(e) => {
                setMinRevenue(e.target.value);
                setPage(1);
              }}
            />
            <input
              className="input"
              placeholder="Min employees"
              style={{ width: 130 }}
              value={minEmployees}
              onChange={(e) => {
                setMinEmployees(e.target.value);
                setPage(1);
              }}
            />
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="revenueUsdM">Sort: revenue</option>
              <option value="employees">Sort: employees</option>
              <option value="name">Sort: name</option>
              <option value="founded">Sort: founded</option>
            </select>
            <button className="button" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>
              {order === 'desc' ? '↓ desc' : '↑ asc'}
            </button>
          </div>

          <div className="responsive-scroll">
            <div className="table accounts-table">
              <div className="table-head">
                <span>
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll}
                  />
                </span>
                <span>Name</span>
                <span>Domain</span>
                <span>Industry</span>
                <span>Size</span>
                <span>Employees</span>
                <span>Revenue</span>
                <span>HQ</span>
                <span />
              </div>
              {items.map((item) => (
                <div className="table-row" key={item.id}>
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    {item.ticker && <small className="muted"> {item.ticker}</small>}
                  </span>
                  <span className="muted">{item.domain ?? '—'}</span>
                  <span className="muted">{item.industry ?? '—'}</span>
                  <span className="muted">{item.size ?? '—'}</span>
                  <span>{fmt(item.employees)}</span>
                  <span>{fmtM(item.revenueUsdM)}</span>
                  <span className="muted">
                    {[item.city, item.state].filter(Boolean).join(', ') || '—'}
                  </span>
                  <span>
                    {item.linkedinUrl && (
                      <a href={item.linkedinUrl} target="_blank" rel="noreferrer" className="muted">
                        in↗
                      </a>
                    )}
                  </span>
                </div>
              ))}
              {!items.length && !loading && (
                <div className="empty-state">
                  {facets && facets.total === 0
                    ? 'No account data loaded yet — run `pnpm accounts:import <csv>` in packages/db.'
                    : 'No accounts match these filters.'}
                </div>
              )}
              {loading && <div className="empty-state">Loading…</div>}
            </div>
          </div>

          <div className="pagination">
            <button className="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {pages} · {total.toLocaleString()} accounts
            </span>
            <button className="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
