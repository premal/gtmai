'use client';

import { useEffect, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Cell = {
  columnId: string;
  value: unknown;
  status: string;
  error?: string;
  provider?: string;
  creditsUsed?: number;
};
type Column = { id: string; name: string; kind: string; type: string };
type Row = { id: string; cells: Cell[] };
type Table = { id: string; name: string; columns: Column[]; rows: Row[] };

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const [tableId, setTableId] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [adding, setAdding] = useState(false);
  const [columnName, setColumnName] = useState('New enrichment');

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
    const stream = new EventSource(
      `${api}/tables/${tableId}/events?token=${encodeURIComponent(token)}`,
    );
    stream.onmessage = () => load();
    return () => stream.close();
  }, [tableId]);

  async function run(columnId: string): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/columns/${columnId}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ onlyEmpty: false }),
    });
  }

  async function addColumn(): Promise<void> {
    const token = localStorage.getItem('gtmai-token') ?? '';
    await fetch(`${api}/tables/${tableId}/columns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: columnName,
        type: 'text',
        kind: 'enrichment',
        config: { provider: 'mock', action: 'mock.findEmail', input: { domain: '{{Domain}}' } },
      }),
    });
    setAdding(false);
    window.location.reload();
  }

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
            <button className="button" onClick={() => setAdding(true)}>
              ＋ Add column
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
        <div className="grid-wrap">
          <table className="data-grid">
            <thead>
              <tr>
                <th className="row-num">#</th>
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="row-num">{index + 1}</td>
                  {table.columns.map((column) => {
                    const cell = row.cells.find((item) => item.columnId === column.id);
                    return (
                      <td key={column.id} onClick={() => cell && setSelected(cell)}>
                        {cell?.status === 'done' ? (
                          <span>{String(cell.value ?? '')}</span>
                        ) : (
                          <span className={`status ${cell?.status ?? 'queued'}`}>
                            {cell?.status ?? 'queued'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {adding && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Add a column</h3>
            <p className="muted">Choose a name and configure an enrichment action.</p>
            <label>
              Column name
              <input value={columnName} onChange={(event) => setColumnName(event.target.value)} />
            </label>
            <div className="picker-grid">
              <button className="picker selected">
                ⚡ Enrichment<strong>Provider action</strong>
              </button>
              <button className="picker">
                ƒ Formula<strong>Live expression</strong>
              </button>
              <button className="picker">
                ✦ Claygent<strong>AI agent</strong>
              </button>
            </div>
            <div className="modal-actions">
              <button className="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void addColumn()}>
                Create column
              </button>
            </div>
          </div>
        </div>
      )}
      {selected && (
        <aside className="detail-drawer">
          <button className="close" onClick={() => setSelected(null)}>
            ×
          </button>
          <div className="eyebrow">CELL DETAIL</div>
          <h3>{String(selected.value ?? selected.status)}</h3>
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
          {selected.error && <p className="error">{selected.error}</p>}
        </aside>
      )}
    </main>
  );
}
