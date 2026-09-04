'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Template = { id: string; name: string; kind: string; definition: unknown };

export default function TemplatesPage() {
  const [items, setItems] = useState<Template[]>([]);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  useEffect(() => {
    if (token)
      void fetch(`${api}/templates`, { headers: { authorization: `Bearer ${token}` } })
        .then((response) => response.json())
        .then(setItems);
  }, [token]);
  async function instantiate(item: Template) {
    const response = await fetch(`${api}/templates/${item.id}/instantiate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const result = (await response.json()) as { kind: string; id: string };
    window.alert(`Created ${result.kind}: ${result.id}`);
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="templates" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">STARTER KITS</div>
            <h2>Templates</h2>
          </div>
        </header>
        <div className="template-grid">
          {items.map((item) => (
            <article className="template-card" key={item.id}>
              <span className="chip">{item.kind}</span>
              <h3>{item.name}</h3>
              <p>Ready-to-use Phase 2 building block for your workspace.</p>
              <button className="button primary" onClick={() => void instantiate(item)}>
                Use template
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
