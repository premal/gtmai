'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';
import { useDialog } from '../components/prompt-dialog';
import { useToast } from '../components/toast';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Budget = { id: string; scope: string; period: string; limit: number; label?: string };
type Alert = { id: string; type: string; message: string; createdAt: string };
type Table = { id: string; name: string };
type Summary = {
  balance: number;
  byTable: { name: string; spend: number }[];
  byProvider: { provider: string; spend: number }[];
  daily: Record<string, number>;
};
type LedgerPage = {
  ledger: {
    id: string;
    delta: number;
    reason: string;
    createdAt: string;
    table?: { name: string };
  }[];
  page: number;
  pages: number;
  total: number;
};
type UsageItem = { key: string; spend: number };

function BarList({ items, empty }: { items: UsageItem[]; empty: string }) {
  const max = Math.max(...items.map((item) => item.spend), 1);
  if (!items.length) return <p className="empty-state">{empty}</p>;
  return (
    <div className="usage-list">
      {items.map((item) => (
        <div className="usage-item" key={item.key}>
          <div className="usage-item-label">
            <strong>{item.key}</strong>
            <span>{item.spend} credits</span>
          </div>
          <div className="usage-track">
            <span style={{ width: `${Math.max(4, (item.spend / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CreditsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<LedgerPage | null>(null);
  const [page, setPage] = useState(1);
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [scope, setScope] = useState('workspace');
  const [period, setPeriod] = useState('daily');
  const [limit, setLimit] = useState(500);
  const [scopeId, setScopeId] = useState('');
  const [message, setMessage] = useState('');
  const dialog = useDialog();
  const { toast } = useToast();
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };
  async function load() {
    const workspace = localStorage.getItem('gtmai-workspace');
    const [
      summaryResponse,
      ledgerResponse,
      usageResponse,
      budgetResponse,
      alertResponse,
      tableResponse,
    ] = await Promise.all([
      fetch(`${api}/credits/summary`, { headers }),
      fetch(`${api}/credits?page=${page}&pageSize=15`, { headers }),
      fetch(`${api}/usage/summary?groupBy=day`, { headers }),
      fetch(`${api}/usage/budgets`, { headers }),
      fetch(`${api}/usage/alerts`, { headers }),
      fetch(`${api}/workspaces/${workspace}/tables`, { headers }),
    ]);
    if (summaryResponse.ok) setSummary((await summaryResponse.json()) as Summary);
    if (ledgerResponse.ok) setLedger((await ledgerResponse.json()) as LedgerPage);
    if (usageResponse.ok) setUsage((await usageResponse.json()) as UsageItem[]);
    if (budgetResponse.ok) setBudgets((await budgetResponse.json()) as Budget[]);
    if (alertResponse.ok) setAlerts((await alertResponse.json()) as Alert[]);
    if (tableResponse.ok) setTables((await tableResponse.json()) as Table[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token, page]);
  async function create() {
    const value = scope === 'workspace' ? 'workspace' : `${scope}:${scopeId}`;
    const existing = budgets.some((budget) => budget.scope === value && budget.period === period);
    const response = await fetch(`${api}/usage/budgets`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: value, period, limit: Number(limit) }),
    });
    if (!response.ok) {
      setMessage((await response.text()) || 'Unable to save budget');
      return;
    }
    await load();
    setMessage(existing ? 'Budget updated' : 'Budget created');
  }
  async function remove(id: string, label: string) {
    if (
      !(await dialog.confirm({
        title: 'Delete budget',
        description: `Delete the credit limit for ${label}?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    const response = await fetch(`${api}/usage/budgets/${id}`, { method: 'DELETE', headers });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to delete budget'), { kind: 'error' });
      return;
    }
    await load();
  }
  const dailyItems = Object.entries(summary?.daily ?? {})
    .slice(-30)
    .map(([key, spend]) => ({ key, spend }));
  return (
    <main className="app-shell">
      <AppNav active="credits" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">USAGE</div>
            <h2>Credits & budgets</h2>
            <p className="muted">Track spend, manage limits, and catch usage spikes.</p>
          </div>
        </header>
        {message && <div className="toast">{message}</div>}
        <div className="page-stack">
          <section className="panel">
            <div className="card-header">
              <div>
                <div className="eyebrow">OVERVIEW</div>
                <h3>Usage dashboard</h3>
              </div>
              <div className="stats">
                <div className="stat">
                  <strong>{summary?.balance ?? 0}</strong>
                  <span>Balance</span>
                </div>
                <div className="stat">
                  <strong>{dailyItems.reduce((total, item) => total + item.spend, 0)}</strong>
                  <span>Last 30 days</span>
                </div>
              </div>
            </div>
            {dailyItems.length ? (
              <div className="daily-bars" aria-label="Daily spend for the last 30 days">
                {dailyItems.map((item) => {
                  const max = Math.max(...dailyItems.map((value) => value.spend), 1);
                  return (
                    <div
                      className="daily-bar"
                      key={item.key}
                      title={`${item.key}: ${item.spend} credits`}
                    >
                      <span style={{ height: `${Math.max(4, (item.spend / max) * 100)}%` }} />
                      <small>{item.key.slice(5)}</small>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No usage recorded yet.</p>
            )}
          </section>
          <div className="split-grid">
            <section className="panel">
              <div className="card-header">
                <h3>Spend by table</h3>
                <span className="muted">{summary?.byTable.length ?? 0} tables</span>
              </div>
              <BarList
                items={(summary?.byTable ?? []).map((item) => ({
                  key: item.name,
                  spend: item.spend,
                }))}
                empty="No table spend yet."
              />
            </section>
            <section className="panel">
              <div className="card-header">
                <h3>Spend by provider</h3>
                <span className="muted">{summary?.byProvider.length ?? 0} providers</span>
              </div>
              <BarList
                items={(summary?.byProvider ?? []).map((item) => ({
                  key: item.provider,
                  spend: item.spend,
                }))}
                empty="No provider spend yet."
              />
            </section>
          </div>
          <section className="panel">
            <div className="card-header">
              <h3>Daily usage</h3>
              <span className="muted">/usage/summary?groupBy=day</span>
            </div>
            <BarList items={usage.slice(-30)} empty="No daily usage yet." />
          </section>
          <div className="split-grid">
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
                Save budget
              </button>
            </section>
            <section className="panel">
              <div className="card-header">
                <h3>Budgets</h3>
                <span className="muted">{budgets.length} configured</span>
              </div>
              {budgets.length ? (
                budgets.map((budget) => (
                  <div className="list-row" key={budget.id}>
                    <span>
                      <strong>{budget.label ?? budget.scope}</strong>
                      <small className="muted">
                        {budget.limit} credits / {budget.period}
                      </small>
                    </span>
                    <button
                      className="button"
                      onClick={() => void remove(budget.id, budget.label ?? budget.scope)}
                    >
                      Delete
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-state">No budgets yet.</p>
              )}
            </section>
          </div>
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
                <small className="muted">{new Date(alert.createdAt).toLocaleString()}</small>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <div className="card-header">
            <h3>Credit ledger</h3>
            <span className="muted">{ledger?.total ?? 0} entries</span>
          </div>
          <div className="responsive-scroll">
            <div className="table ledger-table">
              <div className="table-head">
                <span>Date</span>
                <span>Table</span>
                <span>Reason</span>
                <span>Delta</span>
                <span />
              </div>
              {ledger?.ledger.map((entry) => (
                <div className="table-row" key={entry.id}>
                  <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                  <span>{entry.table?.name ?? 'Workspace'}</span>
                  <span>{entry.reason}</span>
                  <span className={entry.delta < 0 ? 'negative' : 'positive'}>
                    {entry.delta > 0 ? '+' : ''}
                    {entry.delta}
                  </span>
                  <span />
                </div>
              ))}
              {!ledger?.ledger.length && <div className="empty-state">No ledger entries yet.</div>}
            </div>
          </div>
          <div className="pagination">
            <button className="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {ledger?.page ?? page} of {ledger?.pages ?? 1}
            </span>
            <button
              className="button"
              disabled={!ledger || page >= ledger.pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
