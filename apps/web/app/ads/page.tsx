'use client';
import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Audience = {
  id: string;
  name: string;
  platforms: string[];
  syncs: Array<{
    platform: string;
    status: string;
    matched: number;
    uploaded: number;
    syncedAt?: string;
  }>;
};
export default function AdsPage() {
  const [items, setItems] = useState<Audience[]>([]);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const response = await fetch(`${api}/ads/audiences`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setItems((await response.json()) as Audience[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    const name = window.prompt('Audience name', 'Product champions');
    if (!name) return;
    await fetch(`${api}/ads/audiences`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, platforms: ['mock'] }),
    });
    await load();
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="ads" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">ACTIVATION</div>
            <h2>Ad audiences</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            + Create audience
          </button>
        </header>
        <div className="table-list">
          {items.map((item) => (
            <div className="table-card" key={item.id}>
              <strong>{item.name}</strong>
              <span>{item.platforms.join(', ')}</span>
              <div>
                {item.syncs.map((sync) => (
                  <span className="chip" key={sync.platform}>
                    {sync.platform}: {sync.status} ({sync.uploaded})
                  </span>
                ))}
                <button
                  className="button"
                  onClick={() =>
                    void fetch(`${api}/ads/audiences/${item.id}/sync`, {
                      method: 'POST',
                      headers: { authorization: `Bearer ${token}` },
                    }).then(load)
                  }
                >
                  Sync now
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
