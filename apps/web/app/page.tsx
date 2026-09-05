'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppNav } from './app-nav';
import { TagPicker } from './components/tag-picker';
import { useDialog } from './components/prompt-dialog';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Tag = { id: string; name: string; color?: string | null };
type Folder = { id: string; name: string; parentId?: string | null; tags: Tag[] };
type Workbook = {
  id: string;
  name: string;
  folderId?: string | null;
  tags: Tag[];
  _count: { tables: number };
  tables: { id: string; name: string; _count: { rows: number; columns: number } }[];
};

export default function Home() {
  const [token, setToken] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const dialog = useDialog();

  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [folderResponse, workbookResponse, tagResponse] = await Promise.all([
      fetch(`${api}/folders`, { headers }),
      fetch(`${api}/workbooks`, { headers }),
      fetch(`${api}/tags`, { headers }),
    ]);
    setFolders((await folderResponse.json()) as Folder[]);
    setWorkbooks((await workbookResponse.json()) as Workbook[]);
    setTags((await tagResponse.json()) as Tag[]);
  }

  useEffect(() => setToken(localStorage.getItem('gtmai-token') ?? ''), []);
  useEffect(() => {
    if (token) void load();
  }, [token]);

  const visibleWorkbooks = useMemo(
    () =>
      workbooks.filter(
        (workbook) =>
          (selectedFolder === null || workbook.folderId === selectedFolder) &&
          (!tagFilter || workbook.tags.some((tag) => tag.id === tagFilter)),
      ),
    [selectedFolder, tagFilter, workbooks],
  );

  async function createFolder(parentId?: string | null) {
    const values = await dialog.prompt({
      title: 'New folder',
      fields: [{ name: 'name', label: 'Folder name' }],
      confirmLabel: 'Create folder',
    });
    if (!values?.name) return;
    await fetch(`${api}/folders`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: values.name, parentId: parentId ?? undefined }),
    });
    await load();
  }

  async function editFolder(folder: Folder, action: 'rename' | 'move' | 'delete') {
    if (action === 'delete') {
      if (
        !(await dialog.confirm({
          title: 'Delete folder',
          description: `Delete ${folder.name}?`,
          confirmLabel: 'Delete folder',
          danger: true,
        }))
      )
        return;
      await fetch(`${api}/folders/${folder.id}`, { method: 'DELETE', headers: jsonHeaders(token) });
      if (selectedFolder === folder.id) setSelectedFolder(null);
      await load();
      return;
    }
    const values = await dialog.prompt({
      title: action === 'rename' ? 'Rename folder' : 'Move folder',
      fields: [
        {
          name: action === 'rename' ? 'name' : 'parentId',
          label: action === 'rename' ? 'Folder name' : 'Parent folder ID (blank for root)',
          defaultValue: action === 'rename' ? folder.name : (folder.parentId ?? ''),
        },
      ],
      confirmLabel: action === 'rename' ? 'Rename' : 'Move',
    });
    if (!values) return;
    await fetch(`${api}/folders/${folder.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify(
        action === 'rename' ? { name: values.name } : { parentId: values.parentId || null },
      ),
    });
    await load();
  }

  async function createWorkbook() {
    const values = await dialog.prompt({
      title: 'New workbook',
      fields: [{ name: 'name', label: 'Workbook name' }],
      confirmLabel: 'Create workbook',
    });
    if (!values?.name) return;
    await fetch(`${api}/workbooks`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: values.name, folderId: selectedFolder }),
    });
    await load();
  }

  async function editWorkbook(workbook: Workbook, action: 'rename' | 'move' | 'delete') {
    if (action === 'delete') {
      if (
        !(await dialog.confirm({
          title: 'Delete workbook',
          description: `Delete ${workbook.name}?`,
          confirmLabel: 'Delete workbook',
          danger: true,
        }))
      )
        return;
      await fetch(`${api}/workbooks/${workbook.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(token),
      });
      await load();
      return;
    }
    const values = await dialog.prompt({
      title: action === 'rename' ? 'Rename workbook' : 'Move workbook',
      fields: [
        {
          name: action === 'rename' ? 'name' : 'folderId',
          label: action === 'rename' ? 'Workbook name' : 'Folder ID (blank for unfiled)',
          defaultValue: action === 'rename' ? workbook.name : (workbook.folderId ?? ''),
        },
      ],
      confirmLabel: action === 'rename' ? 'Rename' : 'Move',
    });
    if (!values) return;
    await fetch(`${api}/workbooks/${workbook.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify(
        action === 'rename' ? { name: values.name } : { folderId: values.folderId || null },
      ),
    });
    await load();
  }

  if (!token) return <main className="loading">Redirecting to login…</main>;
  return (
    <main className="app-shell">
      <AppNav />
      <section className="content wide">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h2>Workbooks</h2>
            <p className="muted">Organize enrichment tables into focused GTM workspaces.</p>
          </div>
          <div className="toolbar">
            <button className="button" onClick={() => void createFolder(selectedFolder)}>
              ＋ Folder
            </button>
            <button className="button primary" onClick={() => void createWorkbook()}>
              ＋ Workbook
            </button>
          </div>
        </header>
        <div className="tag-filter-row">
          <button
            className={`chip ${!tagFilter ? 'selected' : ''}`}
            onClick={() => setTagFilter('')}
          >
            All tags
          </button>
          {tags.map((tag) => (
            <button
              className={`chip ${tagFilter === tag.id ? 'selected' : ''}`}
              key={tag.id}
              onClick={() => setTagFilter(tag.id)}
            >
              <span className="tag-dot" style={{ background: tag.color ?? '#6366f1' }} />
              {tag.name}
            </button>
          ))}
        </div>
        <div className="workbook-layout">
          <aside className="folder-tree">
            <button
              className={`folder-node root ${selectedFolder === null ? 'selected' : ''}`}
              onClick={() => setSelectedFolder(null)}
            >
              ◫ All workbooks
            </button>
            <FolderTree
              folders={folders}
              parentId={null}
              selectedFolder={selectedFolder}
              collapsed={collapsed}
              onSelect={setSelectedFolder}
              onToggle={(id) =>
                setCollapsed((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                )
              }
              onEdit={editFolder}
            />
          </aside>
          <div className="workbook-grid">
            {visibleWorkbooks.map((workbook) => (
              <article className="workbook-card" key={workbook.id}>
                <div className="workbook-card-header">
                  <a href={`/workbooks/${workbook.id}`}>
                    <span className="table-icon">▤</span>
                    <div>
                      <h3>{workbook.name}</h3>
                      <p>{workbook._count.tables} tables</p>
                    </div>
                  </a>
                  <div className="card-menu">
                    <button className="icon-button">⋮</button>
                    <div className="card-menu-items">
                      <button onClick={() => void editWorkbook(workbook, 'rename')}>Rename</button>
                      <button onClick={() => void editWorkbook(workbook, 'move')}>Move</button>
                      <button onClick={() => void editWorkbook(workbook, 'delete')}>Delete</button>
                    </div>
                  </div>
                </div>
                <div className="workbook-card-tables">
                  {workbook.tables.slice(0, 4).map((table) => (
                    <a href={`/tables/${table.id}`} key={table.id}>
                      <span>▦ {table.name}</span>
                      <small>{table._count.rows} rows</small>
                    </a>
                  ))}
                </div>
                <TagPicker
                  target={{ type: 'workbookId', id: workbook.id }}
                  selected={workbook.tags}
                  onChange={(next) =>
                    setWorkbooks((current) =>
                      current.map((item) =>
                        item.id === workbook.id ? { ...item, tags: next } : item,
                      ),
                    )
                  }
                />
              </article>
            ))}
            {!visibleWorkbooks.length && (
              <div className="empty-state">No workbooks in this view.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function jsonHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function FolderTree({
  folders,
  parentId,
  selectedFolder,
  collapsed,
  onSelect,
  onToggle,
  onEdit,
}: {
  folders: Folder[];
  parentId: string | null;
  selectedFolder: string | null;
  collapsed: string[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (folder: Folder, action: 'rename' | 'move' | 'delete') => void;
}) {
  return (
    <>
      {folders
        .filter((folder) => (folder.parentId ?? null) === parentId)
        .map((folder) => {
          const hasChildren = folders.some((item) => item.parentId === folder.id);
          return (
            <div className="folder-branch" key={folder.id}>
              <div className={`folder-node ${selectedFolder === folder.id ? 'selected' : ''}`}>
                {hasChildren && (
                  <button className="folder-toggle" onClick={() => onToggle(folder.id)}>
                    {collapsed.includes(folder.id) ? '▸' : '▾'}
                  </button>
                )}
                <button className="folder-name" onClick={() => onSelect(folder.id)}>
                  ▰ {folder.name}
                </button>
                <button className="folder-more" onClick={() => onEdit(folder, 'rename')}>
                  ⋮
                </button>
              </div>
              {!collapsed.includes(folder.id) && (
                <FolderTree
                  folders={folders}
                  parentId={folder.id}
                  selectedFolder={selectedFolder}
                  collapsed={collapsed}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onEdit={onEdit}
                />
              )}
            </div>
          );
        })}
    </>
  );
}
