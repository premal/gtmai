'use client';

import { useEffect, useState } from 'react';
import { SignOutFooter } from '../auth';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Member = { user: { name: string; email: string }; role: string };
type ApiKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string };

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState('');
  useEffect(() => {
    const token = localStorage.getItem('gtmai-token') ?? '';
    const workspace = localStorage.getItem('gtmai-workspace') ?? '';
    void fetch(`${api}/workspaces/${workspace}/members`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => response.json() as Promise<Member[]>)
      .then(setMembers);
    void fetch(`${api}/api-keys`, { headers: { authorization: `Bearer ${token}` } })
      .then((response) => response.json() as Promise<ApiKey[]>)
      .then(setKeys);
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
        <SignOutFooter />
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Settings</h2>
          </div>
        </header>
        <div className="settings-card">
          <h3>API keys</h3>
          <p>Create a key for the CLI and MCP. The secret is shown once.</p>
          {newKey && <pre>{newKey}</pre>}
          <button
            className="button primary"
            onClick={async () => {
              const response = await fetch(`${api}/api-keys`, {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${localStorage.getItem('gtmai-token') ?? ''}`,
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ name: 'CLI key' }),
              });
              const result = (await response.json()) as ApiKey & { key: string };
              setNewKey(result.key);
              setKeys([...keys, result]);
            }}
          >
            Create API key
          </button>
          {keys.map((key) => (
            <div className="member-row" key={key.id}>
              <span>
                {key.name}
                <small>{key.prefix}…</small>
              </span>
              <button
                className="button"
                onClick={async () => {
                  await fetch(`${api}/api-keys/${key.id}`, {
                    method: 'DELETE',
                    headers: {
                      authorization: `Bearer ${localStorage.getItem('gtmai-token') ?? ''}`,
                    },
                  });
                  setKeys(keys.filter((item) => item.id !== key.id));
                }}
              >
                Revoke
              </button>
            </div>
          ))}
          <pre>
            gtmai login --api-key gtm_…{'\n'}gtmai sequences list{'\n'}gtmai tables list
          </pre>
        </div>
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
