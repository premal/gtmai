'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
};

export function isAdminRole(role: AuthUser['role'] | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function useMe(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    const token = localStorage.getItem('gtmai-token');
    if (token) void loadCurrentUser(token).then(setUser);
  }, []);
  return user;
}

export function clearAuth(): void {
  localStorage.removeItem('gtmai-token');
  localStorage.removeItem('gtmai-workspace');
}

export function redirectToLogin(): void {
  clearAuth();
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

export function handleUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}

export async function loadCurrentUser(token: string): Promise<AuthUser | null> {
  const response = await fetch(`${api}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (handleUnauthorized(response) || !response.ok) return null;
  return (await response.json()) as AuthUser;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(pathname === '/login');

  useEffect(() => {
    if (pathname === '/login') {
      setReady(true);
      return;
    }
    const token = localStorage.getItem('gtmai-token');
    if (!token) {
      router.replace('/login');
      return;
    }
    let active = true;
    void loadCurrentUser(token).then((user) => {
      if (active && user) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (!ready && pathname !== '/login') {
    return <main className="loading">Checking session…</main>;
  }
  return children;
}

export function SignOutFooter() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('gtmai-token');
    if (!token) return;
    void loadCurrentUser(token).then(setUser);
  }, []);

  return (
    <div className="sidebar-footer">
      <span className="avatar">{(user?.name ?? user?.email ?? 'U').slice(0, 2).toUpperCase()}</span>
      <span>
        {user?.email ?? 'Signed in'}
        {user?.role && <small className="sidebar-role">{user.role}</small>}
      </span>
      <button
        className="icon-button"
        onClick={() => {
          clearAuth();
          window.location.replace('/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
