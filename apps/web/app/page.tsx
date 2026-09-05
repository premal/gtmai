'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppNav } from './app-nav';
import { useDialog } from './components/prompt-dialog';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Table = { id: string; name: string; _count: { rows: number }; columns: { name: string }[] };

export default function Home() {
  const [token, setToken] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [tables, setTables] = useState<Table[]>([]);
  const [search, setSearch] = useState('');
  const dialog = useDialog();

  useEffect(() => {
    const saved = localStorage.getItem('gtmai-token');
    const savedWorkspace = localStorage.getItem('gtmai-workspace');
    if (saved && savedWorkspace) {
      setToken(saved);
      setWorkspace(savedWorkspace);
    }
  }, []);

  useEffect(() => {
    if (!token || !workspace) return;
    void fetch(`${api}/workspaces/${workspace}/tables`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => response.json() as Promise<Table[]>)
      .then(setTables);
  }, [token, workspace]);

  async function createTable(): Promise<void> {
    await fetch(`${api}/workspaces/${workspace}/tables`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New table' }),
    });
    window.location.reload();
  }

  async function deleteTable(id: string): Promise<void> {
    await fetch(`${api}/tables/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    setTables((current) => current.filter((table) => table.id !== id));
  }

  async function renameTable(table: Table): Promise<void> {
    const values = await dialog.prompt({
      title: 'Rename table',
      fields: [{ name: 'name', label: 'Table name', defaultValue: table.name }],
      confirmLabel: 'Rename table',
    });
    if (!values?.name) return;
    const name = values.name;
    await fetch(`${api}/tables/${table.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setTables((current) =>
      current.map((item) => (item.id === table.id ? { ...item, name } : item)),
    );
  }

  const filteredTables = useMemo(
    () => tables.filter((table) => table.name.toLowerCase().includes(search.toLowerCase())),
    [search, tables],
  );

  if (!token) return <main className="loading">Redirecting to login…</main>;

  return (
    <main className="app-shell">
      <AppNav />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Tables</h2>
          </div>
          <input
            className="search-input"
            placeholder="Search tables"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="button primary" onClick={() => void createTable()}>
            ＋ New table
          </button>
        </header>
        <div className="metric-row">
          <div>
            <span className="metric-label">Tables</span>
            <strong>{tables.length}</strong>
          </div>
          <div>
            <span className="metric-label">Workspace</span>
            <strong>Demo</strong>
          </div>
          <div>
            <span className="metric-label">Rows</span>
            <strong>{tables.reduce((total, table) => total + table._count.rows, 0)}</strong>
          </div>
        </div>
        <div className="table-list">
          {filteredTables.map((table) => (
            <div className="table-card" key={table.id}>
              <a className="table-card-link" href={`/tables/${table.id}`}>
                <div className="table-icon">▦</div>
                <div>
                  <h3>{table.name}</h3>
                  <p>
                    {table._count.rows} rows · {table.columns.length} columns
                  </p>
                </div>
                <span className="arrow">→</span>
              </a>
              <button className="icon-button" onClick={() => void renameTable(table)}>
                Rename
              </button>
              <button className="icon-button danger" onClick={() => void deleteTable(table.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
