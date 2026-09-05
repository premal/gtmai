'use client';

import { useEffect, useState, type FormEvent } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState<{
    workspace: string;
    email: string;
    role: string;
    expired: boolean;
    existingUser: boolean;
  } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void params.then(({ token: value }) => {
      setToken(value);
      void fetch(`${api}/auth/invites/${value}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.message ?? 'Invite not found');
          setInvite(data);
        })
        .catch((reason: Error) => setError(reason.message));
    });
  }, [params]);

  async function accept(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`${api}/auth/invites/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message ?? 'Unable to accept invite');
      return;
    }
    localStorage.setItem('gtmai-token', data.token);
    localStorage.setItem('gtmai-workspace', data.workspaceId);
    window.location.replace('/');
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={(event) => void accept(event)}>
        <div className="eyebrow">WORKSPACE INVITE</div>
        <h1>{invite ? `Join ${invite.workspace} as ${invite.role}` : 'Join workspace'}</h1>
        {invite && <p className="muted">{invite.email}</p>}
        {invite && !invite.existingUser && (
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        <label>
          {invite?.existingUser ? 'Password' : 'Create password'}
          <input
            required
            minLength={8}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {invite?.expired && <p className="error">This invite has expired.</p>}
        {error && <p className="error">{error}</p>}
        <button className="button primary" disabled={!invite || invite.expired} type="submit">
          Accept invite
        </button>
      </form>
    </main>
  );
}
