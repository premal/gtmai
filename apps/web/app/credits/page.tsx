'use client';

import { useEffect, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Summary = {
  balance: number;
  byTable: { name: string; spend: number }[];
  byProvider: { provider: string; spend: number }[];
  daily: Record<string, number>;
};

export default function CreditsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    const token = localStorage.getItem('gtmai-token') ?? '';
    void fetch(`${api}/credits/summary`, { headers: { authorization: `Bearer ${token}` } })
      .then((response) => response.json() as Promise<Summary>)
      .then(setSummary);
  }, []);
  const values = summary ? Object.values(summary.daily).slice(-30) : [];
  const max = Math.max(...values, 1);
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <strong>GTM AI</strong>
        </div>
        <nav>
          <a href="/">▦ Tables</a>
          <a href="/connections">⌁ Connections</a>
          <a className="active" href="/credits">
            ◈ Credits
          </a>
          <a href="/settings">⚙ Settings</a>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Credits</h2>
          </div>
        </header>
        <div className="metric-row">
          <div>
            <span className="metric-label">Balance</span>
            <strong>{summary?.balance ?? 0}</strong>
          </div>
          <div>
            <span className="metric-label">Last 30 days</span>
            <strong>{values.reduce((a, b) => a + b, 0)}</strong>
          </div>
        </div>
        <div className="sparkline">
          {values.map((value, index) => (
            <span key={index} style={{ height: `${Math.max(4, (value / max) * 80)}px` }} />
          ))}
        </div>
        <h3>Spend by table</h3>
        <div className="table-list">
          {summary?.byTable.map((item) => (
            <div className="table-card" key={item.name}>
              <strong>{item.name}</strong>
              <span className="arrow">{item.spend} credits</span>
            </div>
          ))}
        </div>
        <h3 className="section-title">Spend by provider</h3>
        <div className="table-list">
          {summary?.byProvider.map((item) => (
            <div className="table-card" key={item.provider}>
              <strong>{item.provider}</strong>
              <span className="arrow">{item.spend} credits</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
