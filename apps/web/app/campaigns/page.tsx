'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';

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
  contact: {
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: { name?: string };
  };
  messages: Message[];
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  stats?: { enrolled: number; sent: number; replied: number };
  enrollments?: Enrollment[];
};

function statusClass(status: string) {
  return status === 'failed' || status === 'bounced' ? 'chip negative' : 'chip';
}

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [drawer, setDrawer] = useState<Enrollment | null>(null);
  const [dialog, setDialog] = useState(false);
  const [message, setMessage] = useState('');
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
    if (!campaignResponse.ok) {
      setMessage('Unable to load campaigns');
      return;
    }
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
  }, [items.length]);

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
    if (!response.ok) {
      setMessage((await response.text()) || 'Unable to create campaign');
      return;
    }
    setDialog(false);
    setMessage('Campaign created');
    await load();
  }

  async function action(id: string, verb: 'start' | 'pause' | 'delete') {
    const response = await fetch(`${api}/campaigns/${id}${verb === 'delete' ? '' : `/${verb}`}`, {
      method: verb === 'delete' ? 'DELETE' : 'POST',
      headers,
    });
    if (!response.ok) {
      setMessage((await response.text()) || `Unable to ${verb} campaign`);
      return;
    }
    if (selected?.id === id) setSelected(null);
    setMessage(
      verb === 'delete'
        ? 'Campaign deleted'
        : verb === 'start'
          ? 'Campaign started'
          : 'Campaign paused',
    );
    await load();
  }

  async function open(item: Campaign) {
    const response = await fetch(`${api}/campaigns/${item.id}`, { headers });
    if (!response.ok) {
      setMessage('Unable to load campaign');
      return;
    }
    setSelected((await response.json()) as Campaign);
  }

  async function openEnrollment(enrollment: Enrollment) {
    if (!selected) return;
    const response = await fetch(`${api}/campaigns/${selected.id}/enrollments/${enrollment.id}`, {
      headers,
    });
    if (response.ok) setDrawer((await response.json()) as Enrollment);
  }

  async function simulateReply(enrollmentId: string) {
    if (!selected) return;
    const response = await fetch(`${api}/campaigns/${selected.id}/replies/ingest`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentId, body: 'Thanks — interested!' }),
    });
    if (!response.ok) {
      setMessage((await response.text()) || 'Unable to simulate reply');
      return;
    }
    await load();
    await open(selected);
    setDrawer(null);
    setMessage('Reply simulated');
  }

  return (
    <main className="app-shell">
      <AppNav active="campaigns" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">OUTBOUND</div>
            <h2>Campaigns</h2>
            <p className="muted">Enroll contacts into sequences and track every message.</p>
          </div>
          <button
            className="button primary"
            onClick={() => {
              setForm({
                name: '',
                sequenceId: sequences[0]?.id ?? '',
                source: 'segment',
                segmentId: segments[0]?.id ?? '',
                emails: '',
              });
              setDialog(true);
            }}
          >
            + Create campaign
          </button>
        </header>
        {message && <div className="toast">{message}</div>}
        <div className="page-stack">
          <div className="card-grid">
            {items.map((item) => (
              <article className="card" key={item.id}>
                <div className="card-header">
                  <button className="unstyled" onClick={() => void open(item)}>
                    <strong>{item.name}</strong>
                    <p className="muted">Open campaign details and enrollments</p>
                  </button>
                  <span className={statusClass(item.status)}>{item.status}</span>
                </div>
                <div className="stats">
                  <div className="stat">
                    <strong>{item.stats?.enrolled ?? 0}</strong>
                    <span>Enrolled</span>
                  </div>
                  <div className="stat">
                    <strong>{item.stats?.sent ?? 0}</strong>
                    <span>Sent</span>
                  </div>
                  <div className="stat">
                    <strong>{item.stats?.replied ?? 0}</strong>
                    <span>Replied</span>
                  </div>
                </div>
                <div className="card-actions">
                  <button className="button" onClick={() => void open(item)}>
                    View enrollments
                  </button>
                  <button className="button" onClick={() => void action(item.id, 'start')}>
                    Start
                  </button>
                  <button className="button" onClick={() => void action(item.id, 'pause')}>
                    Pause
                  </button>
                  <button className="button" onClick={() => void action(item.id, 'delete')}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!items.length && <div className="panel empty-state">No campaigns yet.</div>}
          {selected && (
            <section className="page-stack">
              <div className="topbar">
                <div>
                  <div className="eyebrow">CAMPAIGN</div>
                  <h3>{selected.name} enrollments</h3>
                </div>
                <button className="button" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              <div className="responsive-scroll">
                <div className="table">
                  <div className="table-head">
                    <span>Contact</span>
                    <span>Status</span>
                    <span>Next step</span>
                    <span>Messages</span>
                    <span>Actions</span>
                  </div>
                  {selected.enrollments?.map((enrollment) => (
                    <div className="table-row" key={enrollment.id}>
                      <button className="unstyled" onClick={() => void openEnrollment(enrollment)}>
                        <strong>
                          {enrollment.contact.firstName} {enrollment.contact.lastName}
                        </strong>
                        <span className="muted">{enrollment.contact.email ?? 'No email'}</span>
                      </button>
                      <span className={statusClass(enrollment.status)}>{enrollment.status}</span>
                      <span className="muted">
                        {enrollment.nextStepAt
                          ? new Date(enrollment.nextStepAt).toLocaleString()
                          : 'Not scheduled'}
                      </span>
                      <span className="muted">{enrollment.messages.length} messages</span>
                      <button className="button" onClick={() => void simulateReply(enrollment.id)}>
                        Simulate reply
                      </button>
                    </div>
                  ))}
                  {!selected.enrollments?.length && (
                    <div className="empty-state">No enrollments yet.</div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
        {dialog && (
          <div className="modal-backdrop" onClick={() => setDialog(false)}>
            <section className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-header">
                <div>
                  <div className="eyebrow">NEW CAMPAIGN</div>
                  <h3>Create campaign</h3>
                </div>
                <button className="drawer-close" onClick={() => setDialog(false)}>
                  ×
                </button>
              </div>
              <div className="form-grid">
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
              </div>
              <div className="modal-actions">
                <button className="button" onClick={() => setDialog(false)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => void create()}>
                  Create campaign
                </button>
              </div>
            </section>
          </div>
        )}
        {drawer && (
          <aside className="drawer">
            <div className="drawer-header">
              <div>
                <div className="eyebrow">ENROLLMENT</div>
                <h3>
                  {drawer.contact.firstName} {drawer.contact.lastName}
                </h3>
                <p className="muted">
                  {drawer.contact.email} · {drawer.contact.company?.name ?? 'No company'}
                </p>
              </div>
              <button className="drawer-close" onClick={() => setDrawer(null)}>
                ×
              </button>
            </div>
            <span className={statusClass(drawer.status)}>{drawer.status}</span>
            <p className="muted">
              Next step:{' '}
              {drawer.nextStepAt ? new Date(drawer.nextStepAt).toLocaleString() : 'Not scheduled'}
            </p>
            <div className="drawer-section">
              <h4>Message timeline</h4>
              {drawer.messages.map((message) => (
                <div className="timeline-item" key={message.id}>
                  <div className="card-header">
                    <strong>{message.subject}</strong>
                    <span className="chip">{message.direction}</span>
                  </div>
                  <span className="muted">
                    {message.status} ·{' '}
                    {message.sentAt ? new Date(message.sentAt).toLocaleString() : 'Queued'}
                  </span>
                  <p>{message.body}</p>
                  {message.replies?.map((reply) => (
                    <div className="chip" key={reply.receivedAt}>
                      Reply: {reply.body}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
