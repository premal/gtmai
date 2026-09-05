'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Budget = { id: string; scope: string; period: string; limit: number };
type Alert = { id: string; type: string; message: string; createdAt: string };
type Table = { id: string; name: string };
export default function CreditsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [scope, setScope] = useState('workspace');
  const [period, setPeriod] = useState('daily');
  const [limit, setLimit] = useState(500);
  const [scopeId, setScopeId] = useState('');
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };
  async function load() {
    const workspace = localStorage.getItem('gtmai-workspace');
    const [budgetResponse, alertResponse, tableResponse] = await Promise.all([
      fetch(`${api}/usage/budgets`, { headers }),
      fetch(`${api}/usage/alerts`, { headers }),
      fetch(`${api}/workspaces/${workspace}/tables`, { headers }),
    ]);
    setBudgets((await budgetResponse.json()) as Budget[]);
    setAlerts((await alertResponse.json()) as Alert[]);
    setTables((await tableResponse.json()) as Table[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const value = scope === 'workspace' ? 'workspace' : `${scope}:${scopeId}`;
    await fetch(`${api}/usage/budgets`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: value, period, limit: Number(limit) }),
    });
    await load();
  }
  async function remove(id: string) {
    await fetch(`${api}/usage/budgets/${id}`, { method: 'DELETE', headers });
    await load();
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="credits" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">USAGE</div>
            <h2>Credits & budgets</h2>
          </div>
        </header>
        <div className="grid-2">
          <section className="panel">
            <h3>Create budget</h3>
            <label>
              Scope
              <select
                className="input"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="workspace">workspace</option>
                <option value="table">table</option>
                <option value="provider">provider</option>
              </select>
            </label>
            {scope === 'table' && (
              <label>
                Table
                <select
                  className="input"
                  value={scopeId}
                  onChange={(event) => setScopeId(event.target.value)}
                >
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {scope === 'provider' && (
              <label>
                Provider
                <select
                  className="input"
                  value={scopeId}
                  onChange={(event) => setScopeId(event.target.value)}
                >
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="mock">mock</option>
                </select>
              </label>
            )}
            <label>
              Period
              <select
                className="input"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option>daily</option>
                <option>monthly</option>
              </select>
            </label>
            <label>
              Limit
              <input
                className="input"
                type="number"
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              />
            </label>
            <button className="button primary" onClick={() => void create()}>
              Create budget
            </button>
          </section>
          <section className="panel">
            <h3>Budgets</h3>
            {budgets.map((budget) => (
              <div className="list-row" key={budget.id}>
                <span>
                  <strong>{budget.scope}</strong> · {budget.limit} credits / {budget.period}
                </span>
                <button className="button" onClick={() => void remove(budget.id)}>
                  Delete
                </button>
              </div>
            ))}
          </section>
        </div>
        <section className="panel">
          <h3>Alerts</h3>
          {alerts.length === 0 ? (
            <p>No alerts yet.</p>
          ) : (
            alerts.map((alert) => (
              <div className="list-row" key={alert.id}>
                <span className="chip">{alert.type}</span>
                <span>{alert.message}</span>
                <small>{new Date(alert.createdAt).toLocaleString()}</small>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
