'use client';

import { SignOutFooter } from './auth';

export function Phase2Nav({ active }: { active: string }) {
  const links = [
    ['audiences', '◎ Audiences'],
    ['signals', '◌ Signals'],
    ['workflows', '⌘ Workflows'],
    ['functions', 'ƒ Functions'],
    ['templates', '▤ Templates'],
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">G</span>
        <strong>GTM AI</strong>
      </div>
      <div className="workspace-pill">⌘ Demo Workspace</div>
      <nav>
        <a href="/">▦ Tables</a>
        {links.map(([key, label]) => (
          <a className={active === key ? 'active' : ''} href={`/${key}`} key={key}>
            {label}
          </a>
        ))}
        <a href="/connections">⌁ Connections</a>
        <a href="/credits">◈ Credits</a>
        <a href="/settings">⚙ Settings</a>
      </nav>
      <SignOutFooter />
    </aside>
  );
}
