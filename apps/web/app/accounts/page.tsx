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
type Facet = { value: string; count?: number };
type Facets = {
  total: number;
  industries: Facet[];
  states: Facet[];
  cities: Facet[];
  countries: Facet[];
  sizes: Facet[];
};
type Table = { id: string; name: string };
type SearchSpec = {
  q: string;
  keywords: string;
  identifiers: string;
  industries: string[];
  excludeIndustries: string[];
  regions: string[];
  excludeRegions: string[];
  countries: string[];
  excludeCountries: string[];
  states: string[];
  excludeStates: string[];
  cities: string[];
  excludeCities: string[];
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
// Values map to region keys in the accounts API (macro regions expand to
// country lists, US-* sub-regions expand to state lists).
const REGIONS = [
  'North America',
  'Latin America',
  'EMEA',
  'APAC',
  'US - West',
  'US - Midwest',
  'US - South',
  'US - Northeast',
];
const SAVED_KEY = 'gtmai-account-searches';
const EMPTY_SPEC: SearchSpec = {
  q: '',
  keywords: '',
  identifiers: '',
  industries: [],
  excludeIndustries: [],
  regions: [],
  excludeRegions: [],
  countries: [],
  excludeCountries: [],
  states: [],
  excludeStates: [],
  cities: [],
  excludeCities: [],
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

// Searchable multi-select: chips for picked values, input filters the dropdown.
function Combo({
  label,
  hint,
  placeholder,
  options,
  picked,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  options: Facet[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const pickedSet = new Set(picked.map((p) => p.toLowerCase()));
  const filtered = options
    .filter((o) => o.value && !pickedSet.has(o.value.toLowerCase()))
    .filter((o) => o.value.toLowerCase().includes(text.toLowerCase()))
    .slice(0, 40);

  function add(value: string) {
    onChange([...picked, value]);
    setText('');
  }

  return (
    <div className="combo">
      <div className="combo-label">{label}</div>
      {hint && <div className="combo-hint">{hint}</div>}
      <div className="combo-box">
        {picked.map((value) => (
          <span className="combo-chip" key={value}>
            {value}
            <button
              type="button"
              onClick={() => onChange(picked.filter((p) => p !== value))}
              aria-label={`remove ${value}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className="combo-input"
          placeholder={picked.length ? '' : placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !text && picked.length) {
              onChange(picked.slice(0, -1));
            }
          }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="combo-dropdown">
          {filtered.map((f) => (
            <button
              type="button"
              className="combo-option"
              key={f.value}
              onMouseDown={() => add(f.value)}
            >
              <span className="filter-option-name">{f.value}</span>
              {f.count !== undefined && (
                <span className="filter-option-count">{f.count.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>
      )}
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
    if (spec.keywords) params.keywords = spec.keywords;
    if (spec.identifiers) params.identifiers = spec.identifiers;
    if (spec.industries.length) params.industry = spec.industries.join(',');
    if (spec.excludeIndustries.length) params.excludeIndustry = spec.excludeIndustries.join(',');
    if (spec.regions.length) params.regions = spec.regions.join(',');
    if (spec.excludeRegions.length) params.excludeRegions = spec.excludeRegions.join(',');
    if (spec.countries.length) params.country = spec.countries.join(',');
    if (spec.excludeCountries.length) params.excludeCountry = spec.excludeCountries.join(',');
    if (spec.states.length) params.state = spec.states.join(',');
    if (spec.excludeStates.length) params.excludeState = spec.excludeStates.join(',');
    if (spec.cities.length) params.city = spec.cities.join(',');
    if (spec.excludeCities.length) params.excludeCity = spec.excludeCities.join(',');
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

  const setList = (key: keyof SearchSpec & string) => (next: string[]) =>
    patch({ [key]: next } as Partial<SearchSpec>);

  const toggleSet = (key: keyof SearchSpec & string, value: string) => {
    const current = (spec[key] as string[]) ?? [];
    setList(key)(
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

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

  const industries = (facets?.industries ?? []).filter((f) => f.value);
  const states = (facets?.states ?? []).filter((f) => f.value);
  const cities = (facets?.cities ?? []).filter((f) => f.value);
  const countries = (facets?.countries ?? []).filter((f) => f.value);
  const regions = REGIONS.map((value) => ({ value }));
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
  if (spec.keywords) chips.push({ label: spec.keywords, clear: () => patch({ keywords: '' }) });
  if (spec.identifiers)
    chips.push({ label: 'identifiers', clear: () => patch({ identifiers: '' }) });
  const listChips: [keyof SearchSpec, string, string][] = [
    ['industries', '', ''],
    ['excludeIndustries', 'not ', ''],
    ['regions', '', ''],
    ['excludeRegions', 'not ', ''],
    ['countries', '', ''],
    ['excludeCountries', 'not ', ''],
    ['states', '', ''],
    ['excludeStates', 'not ', ''],
    ['cities', '', ''],
    ['excludeCities', 'not ', ''],
    ['sizes', '', ' emp'],
  ];
  for (const [key, prefix, suffix] of listChips) {
    for (const v of (spec[key] as string[]) ?? [])
      chips.push({ label: `${prefix}${v}${suffix}`, clear: () => toggleSet(key, v) });
  }
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

            <details
              className="filter-section"
              open={spec.industries.length + spec.excludeIndustries.length > 0}
            >
              <summary>Company attributes</summary>
              <Combo
                label="Industries to include"
                placeholder="e.g. Software and IT"
                options={industries}
                picked={spec.industries}
                onChange={setList('industries')}
              />
              <Combo
                label="Industries to exclude"
                placeholder="e.g. Gambling"
                options={industries}
                picked={spec.excludeIndustries}
                onChange={setList('excludeIndustries')}
              />
            </details>

            <details
              className="filter-section"
              open={
                spec.regions.length +
                  spec.excludeRegions.length +
                  spec.countries.length +
                  spec.excludeCountries.length +
                  spec.states.length +
                  spec.excludeStates.length +
                  spec.cities.length +
                  spec.excludeCities.length >
                0
              }
            >
              <summary>Location</summary>
              <Combo
                label="Regions to include"
                placeholder="e.g. EMEA, US - West"
                options={regions}
                picked={spec.regions}
                onChange={setList('regions')}
              />
              <Combo
                label="Regions to exclude"
                placeholder="e.g. APAC"
                options={regions}
                picked={spec.excludeRegions}
                onChange={setList('excludeRegions')}
              />
              <Combo
                label="Countries to include"
                placeholder="e.g. Germany, Brazil"
                options={countries}
                picked={spec.countries}
                onChange={setList('countries')}
              />
              <Combo
                label="Countries to exclude"
                placeholder="e.g. China"
                options={countries}
                picked={spec.excludeCountries}
                onChange={setList('excludeCountries')}
              />
              <Combo
                label="States to include"
                placeholder="e.g. California, New York"
                options={states}
                picked={spec.states}
                onChange={setList('states')}
              />
              <Combo
                label="States to exclude"
                placeholder="e.g. Texas, Florida"
                options={states}
                picked={spec.excludeStates}
                onChange={setList('excludeStates')}
              />
              <Combo
                label="Cities to include"
                placeholder="e.g. San Francisco, Austin"
                options={cities}
                picked={spec.cities}
                onChange={setList('cities')}
              />
              <Combo
                label="Cities to exclude"
                placeholder="e.g. New York"
                options={cities}
                picked={spec.excludeCities}
                onChange={setList('excludeCities')}
              />
            </details>

            <details className="filter-section" open={spec.sizes.length > 0}>
              <summary>Company size</summary>
              <Combo
                label="Employee ranges to include"
                placeholder="e.g. 1001-5000"
                options={sizes}
                picked={spec.sizes}
                onChange={setList('sizes')}
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

            <details className="filter-section" open={Boolean(spec.identifiers)}>
              <summary>Company identifiers</summary>
              <div className="combo">
                <div className="combo-label">Domains or LinkedIn URLs</div>
                <div className="combo-hint">
                  Only return matching domains or LinkedIn URLs. Use one type per search.
                </div>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="e.g. clay.com, linkedin.com/company/clay"
                  value={spec.identifiers}
                  onChange={(e) => patch({ identifiers: e.target.value })}
                />
              </div>
            </details>

            <details className="filter-section" open={Boolean(spec.keywords)}>
              <summary>Products &amp; services</summary>
              <div className="combo">
                <div className="combo-label">Describe products and services</div>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="e.g. sales prospecting tools, solar panels"
                  value={spec.keywords}
                  onChange={(e) => patch({ keywords: e.target.value })}
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
                        {[
                          item.city,
                          item.state,
                          item.country === 'United States' ? null : item.country,
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
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
