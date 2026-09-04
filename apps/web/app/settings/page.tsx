'use client';

import { useEffect, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Member = { user: { name: string; email: string }; role: string };

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const workspace = localStorage.getItem('gtmai-workspace') ?? '';
    void fetch(`${api}/workspaces/${workspace}/members`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => response.json() as Promise<Member[]>)
      .then(setMembers);
  }, []);
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
          <a href="/credits">◈ Credits</a>
          <a className="active" href="/settings">
            ⚙ Settings
          </a>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Settings</h2>
          </div>
        </header>
        <div className="settings-card">
          <h3>Workspace name</h3>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Demo Workspace"
          />
          <button
            className="button primary"
            onClick={async () => {
              const token = localStorage.getItem('gtmai-token') ?? '';
              const workspace = localStorage.getItem('gtmai-workspace') ?? '';
              await fetch(`${api}/workspaces/${workspace}`, {
                method: 'PATCH',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
              });
            }}
          >
            Save
          </button>
        </div>
        <div className="settings-card">
          <h3>Members</h3>
          {members.map((member) => (
            <div className="member-row" key={member.user.email}>
              <span>
                {member.user.name}
                <small>{member.user.email}</small>
              </span>
              <strong>{member.role}</strong>
            </div>
          ))}
        </div>
        <button
          className="button"
          onClick={() => {
            localStorage.clear();
            window.location.href = '/';
          }}
        >
          Log out
        </button>
      </section>
    </main>
  );
}
