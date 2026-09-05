'use client';

import { useEffect, useState } from 'react';
import { Phase2Nav } from '../phase2-nav';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Segment = { id: string; name: string };
type Sequence = { id: string; name: string };
type Message = {
  id: string;
  direction: string;
  subject: string;
  body: string;
  status: string;
  sentAt?: string;
  replies?: Array<{ body: string; receivedAt: string }>;
};
type Enrollment = {
  id: string;
  status: string;
  nextStepAt?: string;
  contact: { email?: string; firstName?: string; lastName?: string; company?: { name?: string } };
  messages: Message[];
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  stats?: { enrolled: number; sent: number; replied: number };
  enrollments?: Enrollment[];
};
export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [drawer, setDrawer] = useState<Enrollment | null>(null);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({
    name: '',
    sequenceId: '',
    source: 'segment',
    segmentId: '',
    emails: '',
  });
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const headers = { authorization: `Bearer ${token}` };
  async function load() {
    const [campaignResponse, sequenceResponse, segmentResponse] = await Promise.all([
      fetch(`${api}/campaigns`, { headers }),
      fetch(`${api}/sequences`, { headers }),
      fetch(`${api}/audiences/segments`, { headers }),
    ]);
    setItems((await campaignResponse.json()) as Campaign[]);
    setSequences((await sequenceResponse.json()) as Sequence[]);
    setSegments((await segmentResponse.json()) as Segment[]);
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  useEffect(() => {
    if (!items.length) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [items]);
  async function create() {
    const contactEmails = form.emails
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
    const response = await fetch(`${api}/campaigns`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        sequenceId: form.sequenceId,
        ...(form.source === 'segment' ? { segmentId: form.segmentId } : { contactEmails }),
      }),
    });
    if (response.ok) {
      setDialog(false);
      setForm({
        name: '',
        sequenceId: sequences[0]?.id ?? '',
        source: 'segment',
        segmentId: segments[0]?.id ?? '',
        emails: '',
      });
      await load();
    }
  }
  async function action(id: string, verb: 'start' | 'pause') {
    await fetch(`${api}/campaigns/${id}/${verb}`, { method: 'POST', headers });
    await load();
  }
  async function open(item: Campaign) {
    const response = await fetch(`${api}/campaigns/${item.id}`, { headers });
    setSelected((await response.json()) as Campaign);
  }
  async function openEnrollment(enrollment: Enrollment) {
    if (!selected) return;
    const response = await fetch(`${api}/campaigns/${selected.id}/enrollments/${enrollment.id}`, {
      headers,
    });
    setDrawer((await response.json()) as Enrollment);
  }
  async function simulateReply(enrollmentId: string) {
    if (!selected) return;
    await fetch(`${api}/campaigns/${selected.id}/replies/ingest`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentId, body: 'Thanks — interested!' }),
    });
    await load();
    await open(selected);
    setDrawer(null);
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
          <button
            className="button primary"
            onClick={() => {
              setForm({
                ...form,
                sequenceId: sequences[0]?.id ?? '',
                segmentId: segments[0]?.id ?? '',
              });
              setDialog(true);
            }}
          >
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
              <button className="button" onClick={() => void action(item.id, 'start')}>
                Start
              </button>
              <button className="button" onClick={() => void action(item.id, 'pause')}>
                Pause
              </button>
            </div>
          ))}
        </div>
        {selected && (
          <div className="panel">
            <div className="list-row">
              <h3>{selected.name} enrollments</h3>
              <button className="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            {selected.enrollments?.map((enrollment) => (
              <button
                className="list-row"
                key={enrollment.id}
                onClick={() => void openEnrollment(enrollment)}
              >
                <span>{enrollment.contact.email ?? 'No email'}</span>
                <span>{enrollment.status}</span>
                <span>
                  {enrollment.nextStepAt
                    ? new Date(enrollment.nextStepAt).toLocaleString()
                    : 'No next step'}
                </span>
                <span>{enrollment.messages.length} messages</span>
                <button
                  className="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void simulateReply(enrollment.id);
                  }}
                >
                  Simulate reply
                </button>
              </button>
            ))}
          </div>
        )}
        {dialog && (
          <div className="modal-backdrop" onClick={() => setDialog(false)}>
            <section className="modal" onClick={(event) => event.stopPropagation()}>
              <h3>Create campaign</h3>
              <label>
                Name
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                Sequence
                <select
                  className="input"
                  value={form.sequenceId}
                  onChange={(event) => setForm({ ...form, sequenceId: event.target.value })}
                >
                  {sequences.map((sequence) => (
                    <option key={sequence.id} value={sequence.id}>
                      {sequence.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select
                  className="input"
                  value={form.source}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                >
                  <option value="segment">Segment</option>
                  <option value="emails">Pasted contact emails</option>
                </select>
              </label>
              {form.source === 'segment' ? (
                <label>
                  Segment
                  <select
                    className="input"
                    value={form.segmentId}
                    onChange={(event) => setForm({ ...form, segmentId: event.target.value })}
                  >
                    {segments.map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Contact emails
                  <textarea
                    className="input"
                    rows={4}
                    placeholder="ada@example.com, grace@example.com"
                    value={form.emails}
                    onChange={(event) => setForm({ ...form, emails: event.target.value })}
                  />
                </label>
              )}
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(false)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => void create()}>
                  Create
                </button>
              </div>
            </section>
          </div>
        )}
        {drawer && (
          <aside className="detail-drawer">
            <button className="drawer-close" onClick={() => setDrawer(null)}>
              ×
            </button>
            <h3>
              {drawer.contact.firstName} {drawer.contact.lastName}
            </h3>
            <p>
              {drawer.contact.email} · {drawer.contact.company?.name ?? 'No company'}
            </p>
            <div className="chip">{drawer.status}</div>
            <p>
              Next step:{' '}
              {drawer.nextStepAt ? new Date(drawer.nextStepAt).toLocaleString() : 'Not scheduled'}
            </p>
            <h4>Message timeline</h4>
            {drawer.messages.map((message) => (
              <div className="panel" key={message.id}>
                <small>
                  {message.direction} · {message.status} ·{' '}
                  {message.sentAt ? new Date(message.sentAt).toLocaleString() : 'queued'}
                </small>
                <strong>{message.subject}</strong>
                <p>{message.body}</p>
                {message.replies?.map((reply) => (
                  <div className="chip" key={reply.receivedAt}>
                    Reply: {reply.body}
                  </div>
                ))}
              </div>
            ))}
          </aside>
        )}
      </section>
    </main>
  );
}
