'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '../app-nav';
import { useToast } from '../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Template = { id: string; name: string; kind: string; definition: unknown };

export default function TemplatesPage() {
  const [items, setItems] = useState<Template[]>([]);
  const router = useRouter();
  const { toast } = useToast();
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
    if (!response.ok) {
      toast('Unable to use template', { kind: 'error' });
      return;
    }
    const result = (await response.json()) as { kind: string; id: string };
    toast(`Created ${item.name}`);
    if (result.kind === 'table') router.push(`/tables/${result.id}`);
    else if (result.kind === 'workflow') router.push(`/workflows/${result.id}`);
    else if (result.kind === 'function') router.push(`/functions?id=${result.id}`);
    else router.push('/templates');
  }
  return (
    <main className="app-shell">
      <AppNav active="templates" />
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
