'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Cell = {
  id?: string;
  columnId: string;
  value: unknown;
  status: string;
  error?: string;
  provider?: string;
  creditsUsed?: number;
  durationMs?: number;
  provenance?: unknown;
};
type Column = {
  id: string;
  name: string;
  kind: string;
  type: string;
  config?: unknown;
  colorLabel?: string;
};
type Row = { id: string; cells: Cell[] };
type Table = { id: string; name: string; columns: Column[]; rows: Row[] };
type ColumnKind = 'input' | 'enrichment' | 'waterfall' | 'agent' | 'formula' | 'http';
type CatalogAction = {
  provider: string;
  id: string;
  name: string;
  category: string;
  creditCost: number;
};

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const [tableId, setTableId] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
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
  const [csv, setCsv] = useState('');
  const [message, setMessage] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void params.then(({ id }) => setTableId(id));
  }, [params]);

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

  async function run(
    columnId: string,
    options: { onlyEmpty?: boolean; onlyErrored?: boolean } = {},
  ): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/columns/${columnId}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...options, rowIds: selectedRows.length ? selectedRows : undefined }),
    });
  }

  async function saveColumn(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const editing = Boolean(selectedColumn);
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
          config:
            kind === 'formula'
              ? { expression }
              : kind === 'agent'
                ? { prompt, outputFields: { answer: 'string' }, provider: 'openai' }
                : kind === 'waterfall'
                  ? { providers: [{ provider, action }], accept }
                  : { provider, action, input: { domain: '{{Domain}}' } },
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

  async function importCsv(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    setImportOpen(false);
    setCsv('');
    await reload();
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
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <strong>GTM AI</strong>
        </div>
        <a className="back-link" href="/">
          ← All tables
        </a>
        <div className="sidebar-section">TABLE</div>
        <div className="current-table">▦ {table.name}</div>
        <nav>
          <a className="active" href={`/tables/${tableId}`}>
            ▤ Grid
          </a>
          <a href="/connections">⌁ Connections</a>
          <a href="/credits">◈ Credits</a>
        </nav>
      </aside>
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">TABLE / PROSPECTS</div>
            <h2>{table.name}</h2>
          </div>
          <div className="toolbar">
            <button
              className="button"
              onClick={() => {
                setSelectedColumn(null);
                setAdding(true);
              }}
            >
              ＋ Add column
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
            <thead>
              <tr>
                <th className="row-num">✓</th>
                {table.columns.map((column) => (
                  <th key={column.id}>
                    <div className="column-title">
                      <span className={`kind-dot ${column.kind}`} />
                      {column.name}
                    </div>
                    <span className="column-meta">
                      {column.kind} · {column.type}
                    </span>
                    <button className="run-link" onClick={() => void run(column.id)}>
                      Run
                    </button>
                    <button
                      className="run-link"
                      onClick={() => {
                        setSelectedColumn(column);
                        setColumnName(column.name);
                        setKind(column.kind as ColumnKind);
                        setAdding(true);
                      }}
                    >
                      Edit
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = table.rows[virtualRow.index]!;
                return (
                  <tr
                    key={row.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      width: '100%',
                    }}
                  >
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
                            cell && setSelected({ ...cell, provenance: cell.provenance })
                          }
                        >
                          {cell?.status === 'done' ? (
                            editable ? (
                              <input
                                className="cell-input"
                                defaultValue={displayValue(cell.value, column)}
                                onBlur={(event) =>
                                  void updateCell(row.id, column, event.target.value)
                                }
                              />
                            ) : (
                              <span title={JSON.stringify(cell.value)}>
                                {displayValue(cell.value, column)}
                              </span>
                            )
                          ) : (
                            <span className={`status ${cell?.status ?? 'queued'}`}>
                              {cell?.status ?? 'queued'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
                  ['input', 'enrichment', 'waterfall', 'agent', 'formula', 'http'] as ColumnKind[]
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
                  <label>
                    Accept rule
                    <select value={accept} onChange={(event) => setAccept(event.target.value)}>
                      <option value="any">Any result</option>
                      <option value="verified-email-only">Verified email only</option>
                    </select>
                  </label>
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
                  </>
                )}
                {kind === 'http' && (
                  <>
                    <label>
                      URL
                      <input placeholder="https://api.example.com/{{Domain}}" />
                    </label>
                    <label>
                      Headers
                      <textarea placeholder='{"Authorization":"Bearer {{API key}}"}' />
                    </label>
                    <label>
                      JSON path
                      <input placeholder="data.email" />
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
            <p className="muted">Paste CSV with a header row. New headers become input columns.</p>
            <textarea
              className="csv-input"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder="First name,Last name\nAda,Lovelace"
            />
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
      {message && <div className="toast">{message}</div>}
      {selected && (
        <aside className="detail-drawer">
          <button className="close" onClick={() => setSelected(null)}>
            ×
          </button>
          <div className="eyebrow">CELL DETAIL</div>
          <h3>{selected.value === undefined ? selected.status : 'Cell value'}</h3>
          <pre className="json-value">{JSON.stringify(selected.value, null, 2)}</pre>
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
              void run(selected.columnId);
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
