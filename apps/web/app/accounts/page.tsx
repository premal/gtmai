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
type SearchSpec = {
  q: string;
  industries: string[];
  states: string[];
  sizes: string[];
  minEmployees: string;
  maxEmployees: string;
  minRevenue: string;
  maxRevenue: string;
  hasDomain: boolean;
  hasLinkedin: boolean;
};
type SavedSearch = { name: string; spec: SearchSpec };

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
const SAVED_KEY = 'gtmai-account-searches';
const EMPTY_SPEC: SearchSpec = {
  q: '',
  industries: [],
  states: [],
  sizes: [],
  minEmployees: '',
  maxEmployees: '',
  minRevenue: '',
  maxRevenue: '',
  hasDomain: false,
  hasLinkedin: false,
};

const fmt = (n?: number) => (n === undefined || n === null ? '—' : n.toLocaleString());
const fmtM = (n?: number) => (n === undefined || n === null ? '—' : `$${n.toLocaleString()}M`);

function FacetList({
  options,
  picked,
  onToggle,
}: {
  options: Facet[];
  picked: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="filter-options">
      {options.map((f) => (
        <label className="filter-option" key={f.value}>
          <input type="checkbox" checked={picked.has(f.value)} onChange={() => onToggle(f.value)} />
          <span className="filter-option-name">{f.value}</span>
          <span className="filter-option-count">{f.count.toLocaleString()}</span>
        </label>
      ))}
    </div>
  );
}

export default function AccountsPage() {
  const [items, setItems] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [spec, setSpec] = useState<SearchSpec>(EMPTY_SPEC);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('revenueUsdM');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [exporting, setExporting] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const dialog = useDialog();
  const { toast } = useToast();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };

  const filterParams = useCallback(() => {
    const params: Record<string, string> = {};
    if (spec.q) params.q = spec.q;
    if (spec.industries.length) params.industry = spec.industries.join(',');
    if (spec.states.length) params.state = spec.states.join(',');
    if (spec.sizes.length) params.size = spec.sizes.join(',');
    if (spec.minEmployees) params.minEmployees = spec.minEmployees;
    if (spec.maxEmployees) params.maxEmployees = spec.maxEmployees;
    if (spec.minRevenue) params.minRevenue = spec.minRevenue;
    if (spec.maxRevenue) params.maxRevenue = spec.maxRevenue;
    if (spec.hasDomain) params.hasDomain = 'true';
    if (spec.hasLinkedin) params.hasLinkedin = 'true';
    return params;
  }, [spec]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({
      ...filterParams(),
      page: String(page),
      limit: '50',
      sort,
      order,
    });
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
  }, [token, page, sort, order, filterParams]);

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
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedSearch[]);
    } catch {
      setSaved([]);
    }
  }, [token]);

  function patch(partial: Partial<SearchSpec>) {
    setSpec((prev) => ({ ...prev, ...partial }));
    setPage(1);
  }

  function toggleSet(key: 'industries' | 'states' | 'sizes', value: string) {
    const next = new Set(spec[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    patch({ [key]: [...next] });
  }

  function onQ(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => patch({ q: value }), 300);
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

  function persistSaved(next: SavedSearch[]) {
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }

  async function saveSearch() {
    const values = await dialog.prompt({
      title: 'Save this search',
      fields: [{ name: 'name', label: 'Search name', defaultValue: '' }],
      confirmLabel: 'Save',
    });
    if (!values?.name?.trim()) return;
    persistSaved([...saved, { name: values.name.trim(), spec }]);
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
        body.filters = filterParams();
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

  const industries = (facets?.industries ?? []).filter((f) => f.value).slice(0, 25);
  const states = (facets?.states ?? []).filter((f) => f.value).slice(0, 25);
  const sizes = SIZE_ORDER.filter((s) => facets?.sizes.some((f) => f.value === s)).map((s) => ({
    value: s,
    count: facets?.sizes.find((f) => f.value === s)?.count ?? 0,
  }));

  const chips: { label: string; clear: () => void }[] = [];
  if (spec.q)
    chips.push({
      label: `"${spec.q}"`,
      clear: () => {
        setQ('');
        patch({ q: '' });
      },
    });
  for (const v of spec.industries)
    chips.push({ label: v, clear: () => toggleSet('industries', v) });
  for (const v of spec.states) chips.push({ label: v, clear: () => toggleSet('states', v) });
  for (const v of spec.sizes) chips.push({ label: `${v} emp`, clear: () => toggleSet('sizes', v) });
  if (spec.minEmployees)
    chips.push({
      label: `≥${spec.minEmployees} employees`,
      clear: () => patch({ minEmployees: '' }),
    });
  if (spec.maxEmployees)
    chips.push({
      label: `≤${spec.maxEmployees} employees`,
      clear: () => patch({ maxEmployees: '' }),
    });
  if (spec.minRevenue)
    chips.push({ label: `≥$${spec.minRevenue}M`, clear: () => patch({ minRevenue: '' }) });
  if (spec.maxRevenue)
    chips.push({ label: `≤$${spec.maxRevenue}M`, clear: () => patch({ maxRevenue: '' }) });
  if (spec.hasDomain) chips.push({ label: 'Has domain', clear: () => patch({ hasDomain: false }) });
  if (spec.hasLinkedin)
    chips.push({ label: 'Has LinkedIn', clear: () => patch({ hasLinkedin: false }) });

  return (
    <main className="app-shell">
      <AppNav active="accounts" />
      <section className="content wide">
        <div className="explore-layout">
          <aside className="filter-rail">
            <div className="filter-rail-head">
              <div className="eyebrow">Company search</div>
              {chips.length > 0 && (
                <button
                  className="link-button"
                  onClick={() => {
                    setSpec(EMPTY_SPEC);
                    setQ('');
                    setPage(1);
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            {saved.length > 0 && (
              <details className="filter-section" open>
                <summary>Past searches</summary>
                <div className="filter-options">
                  {saved.map((s, i) => (
                    <div className="saved-search" key={`${s.name}-${i}`}>
                      <button
                        className="link-button saved-search-name"
                        onClick={() => {
                          setSpec({ ...EMPTY_SPEC, ...s.spec });
                          setQ(s.spec.q);
                          setPage(1);
                        }}
                      >
                        {s.name}
                      </button>
                      <button
                        className="link-button"
                        onClick={() => persistSaved(saved.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <details className="filter-section" open>
              <summary>Keywords</summary>
              <input
                className="search-input"
                placeholder="Name, domain, LinkedIn, ticker…"
                value={q}
                onChange={(event) => onQ(event.target.value)}
                style={{ marginTop: 8, width: '100%' }}
              />
            </details>

            <details className="filter-section" open={spec.industries.length > 0}>
              <summary>Industry</summary>
              <FacetList
                options={industries}
                picked={new Set(spec.industries)}
                onToggle={(v) => toggleSet('industries', v)}
              />
            </details>

            <details className="filter-section" open={spec.states.length > 0}>
              <summary>Location</summary>
              <FacetList
                options={states}
                picked={new Set(spec.states)}
                onToggle={(v) => toggleSet('states', v)}
              />
            </details>

            <details className="filter-section" open={spec.sizes.length > 0}>
              <summary>Company size</summary>
              <FacetList
                options={sizes}
                picked={new Set(spec.sizes)}
                onToggle={(v) => toggleSet('sizes', v)}
              />
            </details>

            <details
              className="filter-section"
              open={Boolean(spec.minEmployees || spec.maxEmployees)}
            >
              <summary>Employee count</summary>
              <div className="filter-range">
                <input
                  className="input"
                  placeholder="Min"
                  inputMode="numeric"
                  value={spec.minEmployees}
                  onChange={(e) => patch({ minEmployees: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Max"
                  inputMode="numeric"
                  value={spec.maxEmployees}
                  onChange={(e) => patch({ maxEmployees: e.target.value })}
                />
              </div>
            </details>

            <details className="filter-section" open={Boolean(spec.minRevenue || spec.maxRevenue)}>
              <summary>Annual revenue</summary>
              <div className="filter-range">
                <input
                  className="input"
                  placeholder="Min $M"
                  inputMode="numeric"
                  value={spec.minRevenue}
                  onChange={(e) => patch({ minRevenue: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Max $M"
                  inputMode="numeric"
                  value={spec.maxRevenue}
                  onChange={(e) => patch({ maxRevenue: e.target.value })}
                />
              </div>
            </details>

            <details className="filter-section" open={spec.hasDomain || spec.hasLinkedin}>
              <summary>Attributes</summary>
              <div className="filter-options">
                <label className="filter-option">
                  <input
                    type="checkbox"
                    checked={spec.hasDomain}
                    onChange={(e) => patch({ hasDomain: e.target.checked })}
                  />
                  <span className="filter-option-name">Has website domain</span>
                </label>
                <label className="filter-option">
                  <input
                    type="checkbox"
                    checked={spec.hasLinkedin}
                    onChange={(e) => patch({ hasLinkedin: e.target.checked })}
                  />
                  <span className="filter-option-name">Has LinkedIn page</span>
                </label>
              </div>
            </details>

            <button className="button" style={{ width: '100%' }} onClick={() => void saveSearch()}>
              Save search
            </button>
          </aside>

          <div className="explore-main">
            <header className="topbar">
              <div>
                <div className="eyebrow">UNIVERSE</div>
                <h2>Accounts</h2>
                <p className="muted">
                  {loading
                    ? 'Loading…'
                    : `Previewing ${items.length} of ${total.toLocaleString()} results`}
                </p>
              </div>
              <div className="topbar-actions">
                <select
                  className="input"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="revenueUsdM">Sort: revenue</option>
                  <option value="employees">Sort: employees</option>
                  <option value="name">Sort: name</option>
                  <option value="founded">Sort: founded</option>
                </select>
                <button
                  className="button"
                  onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
                >
                  {order === 'desc' ? '↓' : '↑'}
                </button>
                <button
                  className="button primary"
                  disabled={exporting}
                  onClick={() => void exportAccounts()}
                >
                  {selected.size
                    ? `Add ${selected.size} selected to table`
                    : 'Add matching to table'}
                </button>
              </div>
            </header>

            {chips.length > 0 && (
              <div className="active-filters">
                {chips.map((chip) => (
                  <button className="chip" key={chip.label} onClick={chip.clear}>
                    {chip.label} <span aria-hidden>✕</span>
                  </button>
                ))}
              </div>
            )}

            <section className="panel">
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
                          <a
                            href={item.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="muted"
                          >
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
                <button
                  className="button"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
