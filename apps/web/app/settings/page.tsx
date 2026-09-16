'use client';

import { AppNav } from '../app-nav';

export default function SettingsPage() {
  return (
    <main className="app-shell">
      <AppNav active="settings" />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Settings</h2>
          </div>
        </header>
        <div className="page-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <div className="eyebrow">PROVIDERS</div>
                <h3>Integrations</h3>
                <p className="muted">
                  Connect provider credentials for enrichment, agents, outbound, ads, and CRM.
                </p>
              </div>
              <a className="button" href="/settings/integrations">
                Manage integrations
              </a>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <div className="eyebrow">TEAM</div>
                <h3>Members</h3>
                <p className="muted">Invite people to the workspace and manage their roles.</p>
              </div>
              <a className="button" href="/settings/team">
                Manage members
              </a>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
