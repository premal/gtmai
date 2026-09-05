'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppNav } from '../../app-nav';
import { useDialog } from '../../components/prompt-dialog';
import { useToast } from '../../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Cell = {
  id?: string;
  rowId?: string;
  columnId: string;
  value: unknown;
  status: string;
  error?: string;
  provider?: string;
  creditsUsed?: number;
  durationMs?: number;
  provenance?: unknown;
};
type SelectedCell = Cell & { rowId: string };
type Column = {
  id: string;
  name: string;
  kind: string;
  type: string;
  width?: number;
  config?: unknown;
  colorLabel?: string;
};
type Row = { id: string; cells: Cell[] };
type Table = { id: string; name: string; columns: Column[]; rows: Row[] };
type ColumnKind = 'input' | 'enrichment' | 'waterfall' | 'agent' | 'formula' | 'http' | 'function';
type RunOptions = {
  rowIds?: string[];
  onlyEmpty?: boolean;
  onlyErrored?: boolean;
};
type CatalogAction = {
  provider: string;
  id: string;
  name: string;
  category: string;
  sourceKind?: 'companies' | 'people';
  creditCost: number;
};
type SourceField = {
  name: string;
  label: string;
  type?: 'text' | 'number';
  required?: boolean;
  hint?: string;
};
const sourceFields: Record<string, SourceField[]> = {
  'theirstack.searchCompanies': [
    {
      name: 'technology',
      label: 'Technology slug',
      required: true,
      hint: 'TheirStack slug, e.g. salesforce, hubspot, clay',
    },
    { name: 'country', label: 'Country (ISO2)' },
    { name: 'minEmployees', label: 'Minimum employees', type: 'number' },
    { name: 'maxEmployees', label: 'Maximum employees', type: 'number' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
};
const sourceActionIds = new Set(Object.keys(sourceFields));
type PeopleField = { name: string; label: string; type?: 'text' | 'number' };
const peopleFields: Record<string, PeopleField[]> = {
  'apollo.peopleSearch': [
    { name: 'titles', label: 'Titles (comma-separated)' },
    { name: 'seniorities', label: 'Seniorities (comma-separated)' },
    { name: 'departments', label: 'Departments (comma-separated)' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  'hunter.domainSearch': [
    { name: 'department', label: 'Department' },
    { name: 'seniority', label: 'Seniority' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  'mock.findPeople': [{ name: 'limit', label: 'Limit', type: 'number' }],
};

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const [tableId, setTableId] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ColumnKind>('enrichment');
  const [columnName, setColumnName] = useState('New enrichment');
  const [columnType, setColumnType] = useState('text');
  const [colorLabel, setColorLabel] = useState('indigo');
  const [runCondition, setRunCondition] = useState('');
  const [provider, setProvider] = useState('mock');
  const [action, setAction] = useState('mock.findEmail');
  const [accept, setAccept] = useState('any');
  const [expression, setExpression] = useState('concat({{First name}}, " ", {{Last name}})');
  const [prompt, setPrompt] = useState('Summarize {{First name}} {{Last name}} at {{Domain}}');
  const [catalog, setCatalog] = useState<CatalogAction[]>([]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceActionId, setSourceActionId] = useState('theirstack.searchCompanies');
  const [sourceInput, setSourceInput] = useState<Record<string, string>>({ limit: '25' });
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleActionId, setPeopleActionId] = useState('mock.findPeople');
  const [peopleInput, setPeopleInput] = useState<Record<string, string>>({ limit: '10' });
  const [peopleDomain, setPeopleDomain] = useState('{{Domain}}');
  const [peopleScope, setPeopleScope] = useState<'selected' | 'all'>('all');
  const [peopleCarry, setPeopleCarry] = useState<string[]>([]);
  const [peopleTableName, setPeopleTableName] = useState('');
  const [csv, setCsv] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [waterfallSteps, setWaterfallSteps] = useState<
    { provider: string; action: string; input: Record<string, string> }[]
  >([{ provider: 'mock', action: 'mock.findEmail', input: {} }]);
  const [httpUrl, setHttpUrl] = useState('');
  const [httpHeaders, setHttpHeaders] = useState('{}');
  const [httpBody, setHttpBody] = useState('');
  const [httpOutputPath, setHttpOutputPath] = useState('');
  const [agentPreview, setAgentPreview] = useState('');
  const [menuColumnId, setMenuColumnId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const dialog = useDialog();
  const { toast } = useToast();
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const editTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void params.then(({ id }) => setTableId(id));
  }, [params]);

  useEffect(() => {
    if (!menuColumnId) return;
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuColumnId(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuColumnId(null);
    }
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuColumnId]);

  useEffect(() => {
    if (!tableId) return;
    const token = localStorage.getItem('gtmai-token') ?? '';
    const load = (): void => {
      void fetch(`${api}/tables/${tableId}`, { headers: { authorization: `Bearer ${token}` } })
        .then((response) => response.json() as Promise<Table>)
        .then(setTable);
    };
    load();
    void fetch(`${api}/providers/catalog`)
      .then((response) => response.json() as Promise<CatalogAction[]>)
      .then(setCatalog);
    const stream = new EventSource(
      `${api}/tables/${tableId}/events?token=${encodeURIComponent(token)}`,
    );
    stream.onmessage = () => load();
    return () => stream.close();
  }, [tableId]);

  async function run(columnId: string, options: RunOptions = {}): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const rowIds = options.rowIds ?? (selectedRows.length ? selectedRows : undefined);
    await fetch(`${api}/tables/${tableId}/columns/${columnId}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...options, rowIds }),
    });
  }

  async function saveColumn(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const editing = Boolean(selectedColumn);
    const defaultInput = fuzzyInputMapping();
    const config =
      kind === 'formula'
        ? { expression }
        : kind === 'agent'
          ? { prompt, outputFields: { answer: 'string', summary: 'string' }, provider: 'openai' }
          : kind === 'waterfall'
            ? {
                providers: waterfallSteps.map((item) => ({
                  ...item,
                  input: Object.keys(item.input).length ? item.input : fuzzyInputMapping(),
                })),
                accept,
              }
            : kind === 'http'
              ? {
                  method: 'GET',
                  url: httpUrl,
                  headers: JSON.parse(httpHeaders || '{}') as Record<string, string>,
                  body: httpBody || undefined,
                  outputPath: httpOutputPath || undefined,
                }
              : kind === 'function'
                ? { functionId: '', input: {} }
                : kind === 'input'
                  ? { value: '' }
                  : { provider, action, input: defaultInput };
    await fetch(
      editing
        ? `${api}/tables/${tableId}/columns/${selectedColumn?.id}`
        : `${api}/tables/${tableId}/columns`,
      {
        method: editing ? 'PATCH' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: columnName,
          type: columnType,
          kind,
          colorLabel,
          runCondition: runCondition || undefined,
          config,
        }),
      },
    );
    setAdding(false);
    setSelectedColumn(null);
    setStep(0);
    await reload();
  }

  async function reload(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const response = await fetch(`${api}/tables/${tableId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setTable((await response.json()) as Table);
  }

  async function addRow(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/rows`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: {} }),
    });
    await reload();
  }

  async function updateCell(rowId: string, column: Column, value: string): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: { [column.name]: value } }),
    });
  }

  function scheduleCellUpdate(rowId: string, column: Column, value: string): void {
    const key = `${rowId}:${column.id}`;
    const existing = editTimers.current.get(key);
    if (existing) clearTimeout(existing);
    editTimers.current.set(
      key,
      setTimeout(() => {
        void updateCell(rowId, column, value);
        editTimers.current.delete(key);
      }, 400),
    );
  }

  function fuzzyInputMapping(): Record<string, string> {
    const columns = table?.columns ?? [];
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const aliases: Record<string, string[]> = {
      firstname: ['firstname', 'givenname', 'first'],
      lastname: ['lastname', 'familyname', 'last'],
      domain: ['domain', 'website', 'webdomain'],
    };
    const keys = action.includes('findEmail') ? ['firstName', 'lastName', 'domain'] : ['domain'];
    return Object.fromEntries(
      keys.flatMap((key) => {
        const match = columns.find((column) =>
          (aliases[normalize(key)] ?? [normalize(key)]).some(
            (alias) => normalize(column.name) === alias,
          ),
        );
        return match ? [[key, `{{${match.name}}}`]] : [];
      }),
    );
  }

  function openColumn(column: Column): void {
    const config = (column.config ?? {}) as Record<string, unknown>;
    setSelectedColumn(column);
    setColumnName(column.name);
    setKind(column.kind as ColumnKind);
    setColumnType(column.type);
    setColorLabel(column.colorLabel ?? 'indigo');
    setRunCondition('');
    setProvider(String(config.provider ?? 'mock'));
    setAction(String(config.action ?? 'mock.findEmail'));
    setExpression(String(config.expression ?? expression));
    setPrompt(String(config.prompt ?? prompt));
    setAccept(String(config.accept ?? 'any'));
    setWaterfallSteps(
      Array.isArray(config.providers)
        ? (config.providers as {
            provider: string;
            action: string;
            input: Record<string, string>;
          }[])
        : [{ provider: 'mock', action: 'mock.findEmail', input: {} }],
    );
    setHttpUrl(String(config.url ?? ''));
    setHttpHeaders(JSON.stringify(config.headers ?? {}, null, 2));
    setHttpBody(typeof config.body === 'string' ? config.body : '');
    setHttpOutputPath(String(config.outputPath ?? ''));
    setStep(0);
    setAdding(true);
  }

  async function importCsv(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const headers = csvFile ? {} : { 'content-type': 'application/json' };
    const body = csvFile
      ? (() => {
          const form = new FormData();
          form.append('mapping', JSON.stringify(mapping));
          form.append('file', csvFile);
          return form;
        })()
      : JSON.stringify({ csv, mapping });
    await fetch(`${api}/tables/${tableId}/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...headers },
      body,
    });
    setImportOpen(false);
    setCsv('');
    setCsvFile(null);
    setCsvHeaders([]);
    await reload();
  }

  async function importSource(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const fields = sourceFields[sourceActionId] ?? [];
    const input = Object.fromEntries(
      fields
        .filter((field) => sourceInput[field.name] !== undefined && sourceInput[field.name] !== '')
        .map((field) => [
          field.name,
          field.type === 'number' ? Number(sourceInput[field.name]) : sourceInput[field.name],
        ]),
    );
    const response = await fetch(`${api}/tables/${tableId}/source`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'theirstack', action: sourceActionId, input }),
    });
    const body = (await response.json()) as { imported?: number; message?: string };
    if (!response.ok) {
      toast(body.message ?? 'Source import failed', { kind: 'error' });
      return;
    }
    setSourceOpen(false);
    await reload();
    toast(`Imported ${body.imported ?? 0} companies`);
  }

  function openPeople(): void {
    if (!table) return;
    const defaults = table.columns
      .filter((column) => ['Company', 'Domain', 'Uses Clay?', 'Evidence URL'].includes(column.name))
      .map((column) => column.name);
    setPeopleCarry(defaults);
    setPeopleTableName(`${table.name} — people`);
    setPeopleActionId(
      catalog.find((item) => item.sourceKind === 'people')?.id ?? 'mock.findPeople',
    );
    setPeopleInput({ limit: '10' });
    setPeopleDomain('{{Domain}}');
    setPeopleScope(selectedRows.length ? 'selected' : 'all');
    setPeopleOpen(true);
  }

  async function fanoutPeople(): Promise<void> {
    if (!table) return;
    const token = localStorage.getItem('gtmai-token') ?? '';
    const selectedAction = catalog.find((item) => item.id === peopleActionId);
    if (!selectedAction) return;
    const fields = peopleFields[peopleActionId] ?? [];
    const actionInput = Object.fromEntries(
      fields
        .filter((field) => peopleInput[field.name] !== undefined && peopleInput[field.name] !== '')
        .map((field) => [
          field.name,
          field.type === 'number' ? Number(peopleInput[field.name]) : peopleInput[field.name],
        ]),
    );
    const response = await fetch(`${api}/tables/${tableId}/fanout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: selectedAction.provider,
        action: selectedAction.id,
        input: { domain: peopleDomain, ...actionInput },
        rowIds: peopleScope === 'selected' ? selectedRows : undefined,
        carry: peopleCarry,
        target: { name: peopleTableName || `${table.name} — people` },
      }),
    });
    const body = (await response.json()) as {
      tableId?: string;
      imported?: number;
      sourceRows?: number;
      errors?: { message: string }[];
      message?: string;
    };
    if (!response.ok) {
      toast(body.message ?? 'Find people failed', { kind: 'error' });
      return;
    }
    setPeopleOpen(false);
    toast(`Found ${body.imported ?? 0} people across ${body.sourceRows ?? 0} companies`);
    if (body.tableId) router.push(`/tables/${body.tableId}`);
  }

  async function previewAgent(): Promise<void> {
    if (!selectedColumn) return;
    const token = localStorage.getItem('gtmai-token') ?? '';
    const response = await fetch(`${api}/tables/${tableId}/columns/${selectedColumn.id}/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const result = (await response.json()) as { previews?: unknown[]; message?: string };
    setAgentPreview(
      result.previews ? JSON.stringify(result.previews, null, 2) : (result.message ?? ''),
    );
  }

  async function previewFormula(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const firstRow = table?.rows[0];
    if (!firstRow || !table) return;
    const row = Object.fromEntries(
      table.columns.map((column) => [
        column.name,
        firstRow.cells.find((cell) => cell.columnId === column.id)?.value ?? '',
      ]),
    );
    const response = await fetch(`${api}/formula/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expression, row }),
    });
    const result = (await response.json()) as { value?: unknown; error?: string };
    setMessage(result.error ?? `Preview: ${String(result.value ?? '')}`);
  }

  async function exportCsv(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const response = await fetch(`${api}/tables/${tableId}/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as { csv: string };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([body.csv], { type: 'text/csv' }));
    link.download = `${table?.name ?? 'table'}.csv`;
    link.click();
  }

  function displayValue(value: unknown, column: Column): string {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value !== 'object') return String(value);
    const record = value as Record<string, unknown>;
    const primary =
      column.type === 'email'
        ? record.email
        : column.type === 'url'
          ? (record.linkedinUrl ?? record.url)
          : column.name.toLowerCase().includes('phone')
            ? record.phone
            : column.name.toLowerCase().includes('company')
              ? ((record.company as Record<string, unknown> | undefined)?.name ?? record.name)
              : (record.fullName ??
                ([record.firstName, record.lastName].filter(Boolean).join(' ') ||
                  record.name ||
                  record.title));
    const extra = Object.keys(record).filter(
      (key) => record[key] !== undefined && key !== 'email',
    ).length;
    return `${String(primary ?? JSON.stringify(value))}${extra > 1 ? `  +${extra - 1} fields` : ''}`;
  }

  const rowVirtualizer = useVirtualizer({
    count: table?.rows.length ?? 0,
    getScrollElement: () => gridRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });
  const actions = useMemo(
    () => catalog.filter((item) => item.provider === provider),
    [catalog, provider],
  );

  if (!table) return <main className="loading">Loading table…</main>;
  return (
    <main className="app-shell">
      <AppNav>
        <a className="back-link" href="/">
          ← All tables
        </a>
        <div className="sidebar-section">TABLE</div>
        <div className="current-table">▦ {table.name}</div>
      </AppNav>
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">TABLE / {table.name.toUpperCase()}</div>
            <h2>{table.name}</h2>
          </div>
          <div className="toolbar">
            <button
              className="button"
              onClick={() => {
                setSelectedColumn(null);
                setColumnName('New enrichment');
                setKind('enrichment');
                setStep(0);
                setAdding(true);
              }}
            >
              ＋ Add column
            </button>
            <button className="button" onClick={() => setSourceOpen(true)}>
              Import from source
            </button>
            <button className="button" onClick={openPeople}>
              Find people
            </button>
            <button className="button" onClick={() => void addRow()}>
              ＋ Row
            </button>
            <button className="button" onClick={() => setImportOpen(true)}>
              Import CSV
            </button>
            <button className="button" onClick={() => void exportCsv()}>
              Export CSV
            </button>
            <button
              className="button primary"
              onClick={() => table.columns.at(-1) && void run(table.columns.at(-1)!.id)}
            >
              ▶ Run column
            </button>
          </div>
        </header>
        <div className="builder-strip">
          <span className="strip-active">Grid</span>
          <span>Waterfall</span>
          <span>Claygent</span>
          <span>Formula</span>
          <span className="strip-spacer" />
          <span className="muted">{table.rows.length} rows · Live updates on</span>
        </div>
        <div className="grid-wrap" ref={gridRef}>
          <table className="data-grid">
            <colgroup>
              <col className="row-num-col" />
              {table.columns.map((column) => (
                <col key={column.id} style={{ width: `${column.width ?? 220}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="row-num">✓</th>
                {table.columns.map((column) => (
                  <th key={column.id}>
                    <div className="column-title">
                      <span className={`kind-dot kind-${column.kind}`} />
                      <span className="column-name" title={column.name}>
                        {column.name}
                      </span>
                    </div>
                    <span className="column-meta">
                      {column.kind} · {column.type}
                    </span>
                    <div className="column-actions">
                      <button className="run-link" onClick={() => void run(column.id)}>
                        ▶ Run
                      </button>
                      <button className="run-link" onClick={() => openColumn(column)}>
                        ✎ Edit
                      </button>
                      <div
                        className="column-menu-anchor"
                        ref={menuColumnId === column.id ? menuRef : undefined}
                      >
                        <button
                          className="icon-button"
                          aria-label={`More actions for ${column.name}`}
                          onClick={() =>
                            setMenuColumnId(menuColumnId === column.id ? null : column.id)
                          }
                        >
                          ⋮
                        </button>
                        {menuColumnId === column.id && (
                          <div className="column-menu">
                            <button
                              onClick={() => {
                                setMenuColumnId(null);
                                void run(column.id, { onlyEmpty: true });
                              }}
                            >
                              Run empty
                            </button>
                            <button
                              onClick={() => {
                                setMenuColumnId(null);
                                void run(column.id, { onlyErrored: true });
                              }}
                            >
                              Run errored
                            </button>
                            <button
                              onClick={() => {
                                setMenuColumnId(null);
                                openColumn(column);
                              }}
                            >
                              Edit config
                            </button>
                            <div className="color-label-row">
                              <div className="menu-label">Color label</div>
                              <div className="color-options">
                                {['indigo', 'green', 'orange', 'pink'].map((color) => (
                                  <button
                                    key={color}
                                    className={`color-dot ${color}`}
                                    aria-label={`Set ${color} label`}
                                    onClick={async () => {
                                      const token = localStorage.getItem('gtmai-token') ?? '';
                                      await fetch(`${api}/tables/${tableId}/columns/${column.id}`, {
                                        method: 'PATCH',
                                        headers: {
                                          authorization: `Bearer ${token}`,
                                          'content-type': 'application/json',
                                        },
                                        body: JSON.stringify({ colorLabel: color }),
                                      });
                                      setMenuColumnId(null);
                                      await reload();
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                setMenuColumnId(null);
                                const values = await dialog.prompt({
                                  title: 'Rename column',
                                  fields: [
                                    {
                                      name: 'name',
                                      label: 'Column name',
                                      defaultValue: column.name,
                                    },
                                  ],
                                  confirmLabel: 'Rename column',
                                });
                                if (!values?.name) return;
                                const name = values.name;
                                const token = localStorage.getItem('gtmai-token') ?? '';
                                await fetch(`${api}/tables/${tableId}/columns/${column.id}`, {
                                  method: 'PATCH',
                                  headers: {
                                    authorization: `Bearer ${token}`,
                                    'content-type': 'application/json',
                                  },
                                  body: JSON.stringify({ name }),
                                });
                                await reload();
                              }}
                            >
                              Rename
                            </button>
                            <button
                              className="danger"
                              onClick={async () => {
                                setMenuColumnId(null);
                                const confirmed = await dialog.confirm({
                                  title: `Delete ${column.name}?`,
                                  description: 'This column and its values will be removed.',
                                  confirmLabel: 'Delete column',
                                  danger: true,
                                });
                                if (!confirmed) return;
                                const token = localStorage.getItem('gtmai-token') ?? '';
                                await fetch(`${api}/tables/${tableId}/columns/${column.id}`, {
                                  method: 'DELETE',
                                  headers: { authorization: `Bearer ${token}` },
                                });
                                await reload();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const virtualRows = rowVirtualizer.getVirtualItems();
                const paddingTop = virtualRows[0]?.start ?? 0;
                const paddingBottom =
                  rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);
                return (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={table.columns.length + 1} style={{ height: paddingTop }} />
                      </tr>
                    )}
                    {virtualRows.map((virtualRow) => {
                      const row = table.rows[virtualRow.index]!;
                      return (
                        <tr key={row.id}>
                          <td className="row-num">
                            <input
                              type="checkbox"
                              checked={selectedRows.includes(row.id)}
                              onChange={(event) =>
                                setSelectedRows((current) =>
                                  event.target.checked
                                    ? [...current, row.id]
                                    : current.filter((id) => id !== row.id),
                                )
                              }
                            />
                          </td>
                          {table.columns.map((column) => {
                            const cell = row.cells.find((item) => item.columnId === column.id);
                            const editable = column.kind === 'input';
                            return (
                              <td
                                key={column.id}
                                onClick={() =>
                                  cell &&
                                  setSelected({
                                    ...cell,
                                    rowId: row.id,
                                    provenance: cell.provenance,
                                  })
                                }
                              >
                                {editable ? (
                                  <input
                                    className="cell-input"
                                    defaultValue={
                                      cell?.value == null ? '' : displayValue(cell.value, column)
                                    }
                                    onChange={(event) =>
                                      scheduleCellUpdate(row.id, column, event.target.value)
                                    }
                                  />
                                ) : !cell ? null : cell.status === 'skipped' ? (
                                  <span className="status skipped" title={cell.error ?? 'Skipped'}>
                                    skipped
                                  </span>
                                ) : cell.status === 'done' ? (
                                  <span className="cell-value" title={JSON.stringify(cell.value)}>
                                    {displayValue(cell.value, column)}
                                  </span>
                                ) : (
                                  <span
                                    className={`status ${cell.status}`}
                                    title={cell.error ?? cell.status}
                                  >
                                    {cell.status === 'error'
                                      ? (cell.error ?? 'error')
                                      : cell.status === 'running'
                                        ? 'running…'
                                        : cell.status}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={table.columns.length + 1} style={{ height: paddingBottom }} />
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
        {selectedRows.length > 0 && (
          <div className="selection-bar">
            {selectedRows.length} selected{' '}
            <button
              className="button"
              onClick={() => table.columns.at(-1) && void run(table.columns.at(-1)!.id)}
            >
              Run selected
            </button>
          </div>
        )}
      </section>
      {adding && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{selectedColumn ? 'Edit column' : 'Add a column'}</h3>
            <p className="muted">Step {step + 1} of 3 · configure a live column.</p>
            <label>
              Column name
              <input value={columnName} onChange={(event) => setColumnName(event.target.value)} />
            </label>
            {step === 0 && (
              <div className="picker-grid">
                {(
                  [
                    'input',
                    'enrichment',
                    'waterfall',
                    'agent',
                    'formula',
                    'http',
                    'function',
                  ] as ColumnKind[]
                ).map((value) => (
                  <button
                    key={value}
                    className={`picker ${kind === value ? 'selected' : ''}`}
                    onClick={() => setKind(value)}
                  >
                    {value}
                    <strong>{value === 'input' ? 'Manual values' : 'Configure action'}</strong>
                  </button>
                ))}
              </div>
            )}
            {step === 1 && (
              <>
                <label>
                  Type
                  <select
                    value={columnType}
                    onChange={(event) => setColumnType(event.target.value)}
                  >
                    <option>text</option>
                    <option>email</option>
                    <option>json</option>
                    <option>url</option>
                  </select>
                </label>
                <label>
                  Provider
                  <select
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value);
                      setAction('');
                    }}
                  >
                    <option value="mock">Mock</option>
                    {[...new Set(catalog.map((item) => item.provider))]
                      .filter((item) => item !== 'mock')
                      .map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                  </select>
                </label>
                {kind !== 'formula' && kind !== 'input' && (
                  <label>
                    Action
                    <select value={action} onChange={(event) => setAction(event.target.value)}>
                      {actions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.category}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {kind === 'waterfall' && (
                  <>
                    <label>
                      Accept rule
                      <select value={accept} onChange={(event) => setAccept(event.target.value)}>
                        <option value="any">Any result</option>
                        <option value="verified-email-only">Verified email only</option>
                      </select>
                    </label>
                    <div className="waterfall-list">
                      {waterfallSteps.map((item, index) => (
                        <div
                          className="waterfall-step"
                          key={`${item.provider}-${item.action}-${index}`}
                        >
                          <strong>
                            {index + 1}. {item.provider} / {item.action}
                          </strong>
                          <button
                            className="icon-button"
                            disabled={index === 0}
                            onClick={() =>
                              setWaterfallSteps((steps) => {
                                const next = [...steps];
                                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                                return next;
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            className="icon-button"
                            disabled={index === waterfallSteps.length - 1}
                            onClick={() =>
                              setWaterfallSteps((steps) => {
                                const next = [...steps];
                                [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                                return next;
                              })
                            }
                          >
                            ↓
                          </button>
                        </div>
                      ))}
                      <button
                        className="button"
                        onClick={() =>
                          setWaterfallSteps((steps) => [
                            ...steps,
                            { provider, action, input: fuzzyInputMapping() },
                          ])
                        }
                      >
                        + Add provider step
                      </button>
                    </div>
                  </>
                )}
                {kind === 'formula' && (
                  <>
                    <label>
                      Formula
                      <textarea
                        value={expression}
                        onChange={(event) => setExpression(event.target.value)}
                      />
                    </label>
                    <button className="button" onClick={() => void previewFormula()}>
                      Preview against row 1
                    </button>
                    <p className="muted">
                      Functions: if, lower, upper, trim, concat, contains, len, coalesce
                    </p>
                  </>
                )}
                {kind === 'agent' && (
                  <>
                    <label>
                      Prompt
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    </label>
                    <label>
                      Output fields
                      <textarea defaultValue={'answer: string\nsummary: string'} />
                    </label>
                    <label>
                      Model
                      <select>
                        <option>gpt-4o-mini</option>
                        <option>claude-3-5-haiku-latest</option>
                      </select>
                    </label>
                    <button className="button" onClick={() => void previewAgent()}>
                      Test on first 3 rows
                    </button>
                    {agentPreview && <pre className="preview-value">{agentPreview}</pre>}
                  </>
                )}
                {kind === 'function' && (
                  <>
                    <label className="field-label">
                      Function ID
                      <input
                        value={String(
                          (selectedColumn?.config as Record<string, unknown> | undefined)
                            ?.functionId ?? '',
                        )}
                        readOnly={Boolean(selectedColumn)}
                      />
                    </label>
                    <label className="field-label">
                      Input bindings JSON
                      <textarea defaultValue="{}" />
                    </label>
                  </>
                )}
                {kind === 'http' && (
                  <>
                    <label>
                      URL
                      <input value={httpUrl} onChange={(event) => setHttpUrl(event.target.value)} />
                    </label>
                    <label>
                      Headers
                      <textarea
                        value={httpHeaders}
                        onChange={(event) => setHttpHeaders(event.target.value)}
                        placeholder='{"Authorization":"Bearer {{API key}}"}'
                      />
                    </label>
                    <label>
                      Body
                      <textarea
                        value={httpBody}
                        onChange={(event) => setHttpBody(event.target.value)}
                      />
                    </label>
                    <label>
                      JSON path
                      <input
                        value={httpOutputPath}
                        onChange={(event) => setHttpOutputPath(event.target.value)}
                        placeholder="data.email"
                      />
                    </label>
                  </>
                )}
                {kind !== 'input' && (
                  <div className="binding-menu">
                    <span className="muted">Insert binding:</span>
                    {table?.columns.slice(0, 6).map((column) => (
                      <button
                        className="icon-button"
                        key={column.id}
                        onClick={() =>
                          kind === 'formula'
                            ? setExpression((value) => `${value}{{${column.name}}}`)
                            : setPrompt((value) => `${value}{{${column.name}}}`)
                        }
                      >
                        {column.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <label>
                  Color label
                  <select
                    value={colorLabel}
                    onChange={(event) => setColorLabel(event.target.value)}
                  >
                    <option>indigo</option>
                    <option>green</option>
                    <option>orange</option>
                    <option>pink</option>
                  </select>
                </label>
                <label>
                  Run condition
                  <input
                    value={runCondition}
                    onChange={(event) => setRunCondition(event.target.value)}
                    placeholder="optional condition"
                  />
                </label>
                <p className="muted">
                  Bindings are supported with {'{{Column name}}'} in action inputs and prompts.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button className="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
              {step > 0 && (
                <button className="button" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              {step < 2 ? (
                <button className="button primary" onClick={() => setStep(step + 1)}>
                  Next
                </button>
              ) : (
                <button className="button primary" onClick={() => void saveColumn()}>
                  {selectedColumn ? 'Save column' : 'Create column'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Import CSV</h3>
            <p className="muted">Paste CSV or upload a file, then map headers to columns.</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setCsvFile(file);
                if (!file) return;
                void file.text().then((text) => {
                  setCsv(text);
                  setCsvHeaders(
                    text
                      .split(/\r?\n/)[0]
                      ?.split(',')
                      .map((value) => value.trim()) ?? [],
                  );
                });
              }}
            />
            <textarea
              className="csv-input"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder="First name,Last name\nAda,Lovelace"
            />
            {csvHeaders.length > 0 && (
              <div className="mapping-list">
                {csvHeaders.map((header) => (
                  <label key={header}>
                    {header}
                    <select
                      value={mapping[header] ?? header}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [header]: event.target.value }))
                      }
                    >
                      <option value={header}>{header} (new/input)</option>
                      {table.columns
                        .filter((column) => column.kind === 'input')
                        .map((column) => (
                          <option key={column.id} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="button" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void importCsv()}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}
      {sourceOpen && (
        <div className="modal-backdrop" onClick={() => setSourceOpen(false)}>
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Import from source</h3>
            <p className="muted">Search a provider and append matching companies as new rows.</p>
            <label>
              Search action
              <select
                value={sourceActionId}
                onChange={(event) => {
                  setSourceActionId(event.target.value);
                  setSourceInput({ limit: '25' });
                }}
              >
                {catalog
                  .filter((item) => item.category === 'search' && sourceActionIds.has(item.id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.provider} · {item.name}
                    </option>
                  ))}
              </select>
            </label>
            {(sourceFields[sourceActionId] ?? []).map((field) => (
              <label key={field.name}>
                {field.label}
                {field.required && ' *'}
                <input
                  type={field.type ?? 'text'}
                  value={sourceInput[field.name] ?? ''}
                  required={field.required}
                  onChange={(event) =>
                    setSourceInput((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                />
                {field.hint && <span className="muted">{field.hint}</span>}
              </label>
            ))}
            <div className="modal-actions">
              <button className="button" onClick={() => setSourceOpen(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void importSource()}>
                Import companies
              </button>
            </div>
          </section>
        </div>
      )}
      {peopleOpen && (
        <div className="modal-backdrop" onClick={() => setPeopleOpen(false)}>
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Find people</h3>
            <p className="muted">Turn company rows into a People table.</p>
            <label>
              Search action
              <select
                value={peopleActionId}
                onChange={(event) => {
                  setPeopleActionId(event.target.value);
                  setPeopleInput({ limit: '10' });
                }}
              >
                {catalog
                  .filter((item) => item.category === 'search' && item.sourceKind === 'people')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.provider} · {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Domain binding
              <input
                value={peopleDomain}
                onChange={(event) => setPeopleDomain(event.target.value)}
              />
            </label>
            {(peopleFields[peopleActionId] ?? []).map((field) => (
              <label key={field.name}>
                {field.label}
                <input
                  type={field.type ?? 'text'}
                  value={peopleInput[field.name] ?? ''}
                  onChange={(event) =>
                    setPeopleInput((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              </label>
            ))}
            <div className="radio-list">
              <label>
                <input
                  type="radio"
                  checked={peopleScope === 'selected'}
                  onChange={() => setPeopleScope('selected')}
                />
                Selected rows ({selectedRows.length})
              </label>
              <label>
                <input
                  type="radio"
                  checked={peopleScope === 'all'}
                  onChange={() => setPeopleScope('all')}
                />
                All rows
              </label>
            </div>
            <div className="mapping-list">
              <strong>Carry columns</strong>
              {table.columns.map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={peopleCarry.includes(column.name)}
                    onChange={(event) =>
                      setPeopleCarry((current) =>
                        event.target.checked
                          ? [...current, column.name]
                          : current.filter((name) => name !== column.name),
                      )
                    }
                  />
                  {column.name}
                </label>
              ))}
            </div>
            <label>
              New table name
              <input
                value={peopleTableName}
                onChange={(event) => setPeopleTableName(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="button" onClick={() => setPeopleOpen(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void fanoutPeople()}>
                Find people
              </button>
            </div>
          </section>
        </div>
      )}
      {message && <div className="toast">{message}</div>}
      {selected && (
        <aside className="detail-drawer">
          <button className="close" onClick={() => setSelected(null)}>
            ×
          </button>
          <div className="eyebrow">CELL DETAIL</div>
          <h3>{selected.status === 'skipped' ? 'Cell skipped' : 'Cell value'}</h3>
          <pre className="json-value">
            {selected.status === 'skipped' ? '—' : JSON.stringify(selected.value, null, 2)}
          </pre>
          <div className="detail-row">
            <span>Status</span>
            <strong>{selected.status}</strong>
          </div>
          <div className="detail-row">
            <span>Provider</span>
            <strong>{selected.provider ?? '—'}</strong>
          </div>
          <div className="detail-row">
            <span>Credits</span>
            <strong>{selected.creditsUsed ?? 0}</strong>
          </div>
          <div className="detail-row">
            <span>Duration</span>
            <strong>{selected.durationMs ?? 0} ms</strong>
          </div>
          <div className="detail-row">
            <span>Provenance</span>
            <strong>{selected.provenance ? 'Available' : '—'}</strong>
          </div>
          {selected.error && <p className="error">{selected.error}</p>}
          <button
            className="button primary"
            onClick={() => {
              void run(selected.columnId, { rowIds: [selected.rowId] });
              setSelected(null);
            }}
          >
            ↻ Re-run cell
          </button>
        </aside>
      )}
    </main>
  );
}
