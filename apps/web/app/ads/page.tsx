'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Segment = { id: string; name: string };
type Sync = {
  platform: string;
  status: string;
  matched: number;
  uploaded: number;
  syncedAt?: string;
  error?: string;
};
type Audience = {
  id: string;
  name: string;
  segmentId?: string;
  platforms: string[];
  syncs: Sync[];
};
const platformOptions = ['mock', 'meta', 'google', 'linkedin'];
export default function AdsPage() {
  const [items, setItems] = useState<Audience[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', segmentId: '', platforms: ['mock'] });
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };
  async function load() {
    const [audiences, segmentResponse] = await Promise.all([
      fetch(`${api}/ads/audiences`, { headers }),
      fetch(`${api}/audiences/segments`, { headers }),
    ]);
    setItems((await audiences.json()) as Audience[]);
    setSegments((await segmentResponse.json()) as Segment[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    await fetch(`${api}/ads/audiences`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setOpen(false);
    await load();
  }
  async function sync(id: string) {
    await fetch(`${api}/ads/audiences/${id}/sync`, { method: 'POST', headers });
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
          <button
            className="button primary"
            onClick={() => {
              setForm({ name: '', segmentId: segments[0]?.id ?? '', platforms: ['mock'] });
              setOpen(true);
            }}
          >
            + Create audience
          </button>
        </header>
        <div className="table-list">
          {items.map((item) => (
            <div className="table-card" key={item.id}>
              <strong>{item.name}</strong>
              <span>
                {item.platforms.join(', ')}{' '}
                {item.segmentId
                  ? `· ${segments.find((segment) => segment.id === item.segmentId)?.name ?? 'segment'}`
                  : ''}
              </span>
              <div>
                {item.syncs.map((syncItem) => (
                  <div className="panel" key={syncItem.platform}>
                    <div className="list-row">
                      <strong>{syncItem.platform}</strong>
                      <span className={`chip ${syncItem.status === 'failed' ? 'negative' : ''}`}>
                        {syncItem.status}
                      </span>
                      <span>
                        {syncItem.matched} matched · {syncItem.uploaded} uploaded ·{' '}
                        {syncItem.syncedAt ? new Date(syncItem.syncedAt).toLocaleString() : '—'}
                      </span>
                    </div>
                    {syncItem.error && <p className="negative">{syncItem.error}</p>}
                  </div>
                ))}
                <button className="button" onClick={() => void sync(item.id)}>
                  Sync now
                </button>
              </div>
            </div>
          ))}
        </div>
        {open && (
          <div className="modal-backdrop" onClick={() => setOpen(false)}>
            <section className="modal" onClick={(event) => event.stopPropagation()}>
              <h3>Create audience</h3>
              <label>
                Name
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                Segment
                <select
                  className="input"
                  value={form.segmentId}
                  onChange={(event) => setForm({ ...form, segmentId: event.target.value })}
                >
                  <option value="">All contacts</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Platforms</legend>
                {platformOptions.map((platform) => (
                  <label key={platform}>
                    <input
                      type="checkbox"
                      checked={form.platforms.includes(platform)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          platforms: event.target.checked
                            ? [...form.platforms, platform]
                            : form.platforms.filter((item) => item !== platform),
                        })
                      }
                    />{' '}
                    {platform}
                  </label>
                ))}
              </fieldset>
              <div className="modal-actions">
                <button className="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => void create()}>
                  Create
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
