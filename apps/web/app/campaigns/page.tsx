'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Campaign = {
  id: string;
  name: string;
  status: string;
  stats?: { enrolled: number; sent: number; replied: number };
  enrollments?: Array<{
    id: string;
    status: string;
    contact: { email?: string; firstName?: string; lastName?: string };
    messages: Array<{ subject: string; body: string; status: string; sentAt?: string }>;
  }>;
};
type Sequence = { id: string; name: string };
export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [campaignResponse, sequenceResponse] = await Promise.all([
      fetch(`${api}/campaigns`, { headers }),
      fetch(`${api}/sequences`, { headers }),
    ]);
    setItems((await campaignResponse.json()) as Campaign[]);
    setSequences((await sequenceResponse.json()) as Sequence[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function create() {
    if (!sequences[0]) return;
    const name = window.prompt('Campaign name', 'New campaign');
    if (!name) return;
    await fetch(`${api}/campaigns`, {
      method: 'POST',
      headers: { ...{ authorization: `Bearer ${token}` }, 'content-type': 'application/json' },
      body: JSON.stringify({ name, sequenceId: sequences[0].id, contactIds: [] }),
    });
    await load();
  }
  async function action(id: string, verb: 'start' | 'pause') {
    await fetch(`${api}/campaigns/${id}/${verb}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    await load();
  }
  async function open(item: Campaign) {
    const response = await fetch(`${api}/campaigns/${item.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setSelected((await response.json()) as Campaign);
  }
  return (
    <main className="app-shell">
      <Phase2Nav active="campaigns" />
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">OUTBOUND</div>
            <h2>Campaigns</h2>
          </div>
          <button className="button primary" onClick={() => void create()}>
            + Create campaign
          </button>
        </header>
        <div className="table-list">
          {items.map((item) => (
            <div className="table-card" key={item.id}>
              <button className="unstyled" onClick={() => void open(item)}>
                <strong>{item.name}</strong>
                <span>
                  {item.status} · {item.stats?.enrolled ?? 0} enrolled · {item.stats?.sent ?? 0}{' '}
                  sent · {item.stats?.replied ?? 0} replied
                </span>
              </button>
              <div>
                <button className="button" onClick={() => void action(item.id, 'start')}>
                  Start
                </button>{' '}
                <button className="button" onClick={() => void action(item.id, 'pause')}>
                  Pause
                </button>
              </div>
            </div>
          ))}
        </div>
        {selected && (
          <div className="panel">
            <h3>{selected.name} enrollments</h3>
            {selected.enrollments?.map((enrollment) => (
              <div className="list-row" key={enrollment.id}>
                <span>{enrollment.contact.email ?? 'No email'}</span>
                <span>{enrollment.status}</span>
                <span>{enrollment.messages.length} messages</span>
                <button
                  className="button"
                  onClick={() =>
                    void fetch(`${api}/campaigns/${selected.id}/replies/ingest`, {
                      method: 'POST',
                      headers: {
                        ...{ authorization: `Bearer ${token}` },
                        'content-type': 'application/json',
                      },
                      body: JSON.stringify({
                        enrollmentId: enrollment.id,
                        body: 'Thanks — interested!',
                      }),
                    }).then(() => open(selected))
                  }
                >
                  Simulate reply
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
