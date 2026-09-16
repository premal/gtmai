'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SignOutFooter } from './auth';

export function AppNav({
  active: activeOverride,
  children,
}: {
  active?: string;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const links: [string, string, string?][] = [
    ['tables', '▤ Workbooks', '/'],
    ['audiences', '◎ Audiences'],
    ['sequences', '✉ Sequences'],
    ['campaigns', '➜ Campaigns'],
    ['ads', '◉ Ads'],
    ['crm', '↗ CRM'],
    ['signals', '◌ Signals'],
    ['workflows', '⌘ Workflows'],
    ['functions', 'ƒ Functions'],
    ['templates', '▤ Templates'],
  ];
  const utilityLinks: [string, string][] = [
    ['connections', '⌁ Connections'],
    ['credits', '◈ Credits'],
    ['settings', '⚙ Settings'],
  ];
  const active = (key: string, href?: string): boolean => {
    if (activeOverride) return activeOverride === key;
    const currentPath = pathname ?? '';
    const route = href ?? `/${key}`;
    return key === 'tables'
      ? currentPath === '/' || currentPath.startsWith('/tables/')
      : currentPath === route || currentPath.startsWith(`${route}/`);
  };
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">G</span>
        <strong>GTM AI</strong>
      </div>
      <div className="workspace-pill">⌘ Demo Workspace</div>
      {children && <div className="sidebar-context">{children}</div>}
      <nav>
        {links.map(([key, label, href]) => (
          <a className={active(key, href) ? 'active' : ''} href={href ?? `/${key}`} key={key}>
            {label}
          </a>
        ))}
        <div className="nav-divider" />
        {utilityLinks.map(([key, label]) => (
          <a className={active(key) ? 'active' : ''} href={`/${key}`} key={key}>
            {label}
          </a>
        ))}
      </nav>
      <SignOutFooter />
    </aside>
  );
}
