'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Table = { id: string; name: string; _count: { rows: number }; columns: { name: string }[] };

export default function Home() {
  const [email, setEmail] = useState('demo@gtmai.dev');
  const [password, setPassword] = useState('demo1234');
  const [token, setToken] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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

  async function login(event: FormEvent): Promise<void> {
    event.preventDefault();
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await response.json()) as {
      token?: string;
      workspaceId?: string;
      error?: string;
    };
    if (!response.ok || !data.token || !data.workspaceId) {
      setError(data.error ?? 'Login failed');
      return;
    }
    localStorage.setItem('gtmai-token', data.token);
    localStorage.setItem('gtmai-workspace', data.workspaceId);
    setToken(data.token);
    setWorkspace(data.workspaceId);
  }

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
    const name = window.prompt('Table name', table.name);
    if (!name) return;
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

  if (!token) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={(event) => void login(event)}>
          <div className="eyebrow">REVENUE OPERATIONS</div>
          <h1>GTM AI</h1>
          <p className="muted">A focused workspace for enrichment and outbound data.</p>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button primary" type="submit">
            Log in
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <strong>GTM AI</strong>
        </div>
        <div className="workspace-pill">⌘ Demo Workspace</div>
        <nav>
          <a className="active" href="/">
            ▦ Tables
          </a>
          <a href="/connections">⌁ Connections</a>
          <a href="/credits">◈ Credits</a>
          <a href="/settings">⚙ Settings</a>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">DU</span>
          <span>Demo User</span>
        </div>
      </aside>
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
            <span className="metric-label">Plan</span>
            <strong>Phase 1</strong>
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
