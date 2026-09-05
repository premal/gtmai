'use client';

import { useEffect, useState } from 'react';
import { AppNav } from '../app-nav';
import { isAdminRole, useMe } from '../auth';
import { useDialog } from '../components/prompt-dialog';
import { useToast } from '../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Member = {
  id?: string;
  user?: { name: string; email: string };
  name?: string;
  email?: string;
  role: string;
};
type ApiKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string };
type Invite = { id: string; email: string; role: string; url: string; expiresAt: string };
const isAdminMember = (role: string) => role === 'owner' || role === 'admin';

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const me = useMe();
  const dialog = useDialog();
  const { toast } = useToast();
  const admin = isAdminRole(me?.role);
  const adminCount = members.filter((member) => isAdminMember(member.role)).length;
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  useEffect(() => {
    const workspace = localStorage.getItem('gtmai-workspace') ?? '';
    void fetch(`${api}${admin ? '/team/members' : `/workspaces/${workspace}/members`}`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => response.json() as Promise<Member[]>)
      .then(setMembers);
    void fetch(`${api}/api-keys`, { headers: { authorization: `Bearer ${token}` } })
      .then((response) => response.json() as Promise<ApiKey[]>)
      .then(setKeys);
    if (admin) {
      void fetch(`${api}/team/invites`, { headers: { authorization: `Bearer ${token}` } })
        .then((response) => (response.ok ? response.json() : []))
        .then(setInvites);
    }
  }, [admin, token]);
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
                <div className="eyebrow">DEVELOPER ACCESS</div>
                <h3>API keys</h3>
                <p className="muted">Create a key for the CLI and MCP. The secret is shown once.</p>
              </div>
              {admin && (
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
                    if (!response.ok) {
                      toast(await responseMessage(response, 'Unable to create API key'), {
                        kind: 'error',
                      });
                      return;
                    }
                    const result = (await response.json()) as ApiKey & { key: string };
                    setNewKey(result.key);
                    setKeys([...keys, result]);
                  }}
                >
                  Create API key
                </button>
              )}
            </div>
            {newKey && <pre className="code-block">{newKey}</pre>}
            <div className="page-stack">
              {keys.map((key) => (
                <div className="list-row" key={key.id}>
                  <span>
                    <strong>{key.name}</strong>
                    <small className="muted">
                      {key.prefix}… · created {new Date(key.createdAt).toLocaleDateString()}
                    </small>
                  </span>
                  {admin && (
                    <button
                      className="button"
                      onClick={async () => {
                        const response = await fetch(`${api}/api-keys/${key.id}`, {
                          method: 'DELETE',
                          headers: {
                            authorization: `Bearer ${localStorage.getItem('gtmai-token') ?? ''}`,
                          },
                        });
                        if (!response.ok) {
                          toast(await responseMessage(response, 'Unable to revoke API key'), {
                            kind: 'error',
                          });
                          return;
                        }
                        setKeys(keys.filter((item) => item.id !== key.id));
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
            <pre className="code-block">
              gtmai login --api-key gtm_…{'\n'}gtmai sequences list{'\n'}gtmai tables list
            </pre>
          </section>
        </div>
        {admin && (
          <div className="card">
            <h3>Workspace name</h3>
            <input
              className="input"
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
        )}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="eyebrow">TEAM</div>
              <h3>Members</h3>
            </div>
            {admin && (
              <form
                className="inline-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const response = await fetch(`${api}/team/invites`, {
                    method: 'POST',
                    headers: {
                      authorization: `Bearer ${token}`,
                      'content-type': 'application/json',
                    },
                    body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
                  });
                  if (!response.ok) return;
                  setInvites([...invites, (await response.json()) as Invite]);
                  setInviteEmail('');
                }}
              >
                <input
                  placeholder="Invite email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="button primary" type="submit">
                  ＋ Invite
                </button>
              </form>
            )}
          </div>
          {members.map((member) => (
            <div className="list-row" key={member.id ?? member.user?.email ?? member.email}>
              <span className="page-stack">
                <strong>{member.user?.name ?? member.name}</strong>
                <small className="muted">{member.user?.email ?? member.email}</small>
              </span>
              <span className="toolbar">
                {admin && member.id ? (
                  <select
                    value={member.role}
                    onChange={async (event) => {
                      const response = await fetch(`${api}/team/members/${member.id}`, {
                        method: 'PATCH',
                        headers: {
                          authorization: `Bearer ${token}`,
                          'content-type': 'application/json',
                        },
                        body: JSON.stringify({ role: event.target.value }),
                      });
                      if (response.ok) {
                        const refreshed = await fetch(`${api}/team/members`, {
                          headers: { authorization: `Bearer ${token}` },
                        });
                        if (refreshed.ok) setMembers((await refreshed.json()) as Member[]);
                        else
                          toast(
                            await responseMessage(refreshed, 'Unable to refresh team members'),
                            { kind: 'error' },
                          );
                      } else {
                        toast(await responseMessage(response, 'Unable to update member role'), {
                          kind: 'error',
                        });
                      }
                    }}
                    disabled={isAdminMember(member.role) && adminCount <= 1}
                  >
                    {member.role === 'owner' && <option value="owner">Owner (admin)</option>}
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <strong>{member.role}</strong>
                )}
                {admin && member.id && (
                  <button
                    className="button"
                    disabled={isAdminMember(member.role) && adminCount <= 1}
                    onClick={async () => {
                      if (
                        !(await dialog.confirm({
                          title: 'Remove team member',
                          description: `Remove ${member.email ?? member.user?.email}?`,
                          confirmLabel: 'Remove',
                          danger: true,
                        }))
                      )
                        return;
                      const response = await fetch(`${api}/team/members/${member.id}`, {
                        method: 'DELETE',
                        headers: { authorization: `Bearer ${token}` },
                      });
                      if (response.ok)
                        setMembers((current) => current.filter((item) => item.id !== member.id));
                      else
                        toast(await responseMessage(response, 'Unable to remove team member'), {
                          kind: 'error',
                        });
                    }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
          {admin && invites.length > 0 && (
            <div className="page-stack">
              <h4>Pending invites</h4>
              {invites.map((invite) => (
                <div className="list-row" key={invite.id}>
                  <span>
                    {invite.email}
                    <small>{invite.role}</small>
                  </span>
                  <span className="toolbar">
                    <button
                      className="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(invite.url);
                        toast('Link copied');
                      }}
                    >
                      Copy link
                    </button>
                    <button
                      className="button"
                      onClick={async () => {
                        const response = await fetch(`${api}/team/invites/${invite.id}`, {
                          method: 'DELETE',
                          headers: { authorization: `Bearer ${token}` },
                        });
                        if (response.ok)
                          setInvites((current) => current.filter((item) => item.id !== invite.id));
                        else
                          toast(await responseMessage(response, 'Unable to revoke invite'), {
                            kind: 'error',
                          });
                      }}
                    >
                      Revoke
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
