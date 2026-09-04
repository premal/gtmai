'use client';

import { FormEvent, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch(`${api}/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { email, password, name } : { email, password }),
      });
      const data = (await response.json()) as {
        token?: string;
        workspaceId?: string;
        message?: string;
        error?: string;
      };
      if (!response.ok || !data.token || !data.workspaceId) {
        setError(
          data.message ?? data.error ?? `${mode === 'login' ? 'Login' : 'Registration'} failed`,
        );
        return;
      }
      localStorage.setItem('gtmai-token', data.token);
      localStorage.setItem('gtmai-workspace', data.workspaceId);
      window.location.replace('/');
    } catch {
      setError('The API is unavailable. Check that the local services are running.');
    } finally {
      setSubmitting(false);
    }
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="eyebrow">REVENUE OPERATIONS</div>
        <h1>GTM AI</h1>
        <p className="muted">A focused workspace for enrichment and outbound data.</p>
        <div className="login-tabs">
          <button
            className={mode === 'login' ? 'active' : ''}
            type="button"
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            type="button"
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        {mode === 'register' && (
          <label>
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
            />
          </label>
        )}
        <label>
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={isDevelopment ? 'demo@gtmai.dev' : 'you@company.com'}
          />
        </label>
        <label>
          Password
          <input
            required
            minLength={8}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isDevelopment ? 'demo1234' : 'At least 8 characters'}
          />
        </label>
        {isDevelopment && <p className="muted login-hint">Demo: demo@gtmai.dev / demo1234</p>}
        <button className="button primary" disabled={submitting} type="submit">
          {submitting ? 'Working…' : mode === 'login' ? 'Log in' : 'Create workspace'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
