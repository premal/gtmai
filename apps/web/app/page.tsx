'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AppNav } from './app-nav';
import { TagPicker } from './components/tag-picker';
import { useDialog } from './components/prompt-dialog';
import { useToast } from './components/toast';

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
type SearchResult = {
  id: string;
  name: string;
  kind: 'folder' | 'workbook' | 'table';
  tags: Tag[];
  folderId?: string;
  workbookId?: string;
  workbookName?: string;
  folderName?: string;
  updatedAt: string;
};
type SearchResults = {
  folders: SearchResult[];
  workbooks: SearchResult[];
  tables: SearchResult[];
};
type MenuState =
  | { kind: 'folder'; item: Folder; top: number; left: number }
  | { kind: 'workbook'; item: Workbook; top: number; left: number }
  | null;

export default function Home() {
  const [token, setToken] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialog = useDialog();
  const { toast } = useToast();

  async function load() {
    const headers = { authorization: `Bearer ${token}` };
    const [folderResponse, workbookResponse, tagResponse] = await Promise.all([
      fetch(`${api}/folders`, { headers }),
      fetch(`${api}/workbooks`, { headers }),
      fetch(`${api}/tags`, { headers }),
    ]);
    if (!folderResponse.ok || !workbookResponse.ok || !tagResponse.ok) {
      const failed = [folderResponse, workbookResponse, tagResponse].find(
        (response) => !response.ok,
      );
      toast(await responseMessage(failed, 'Unable to load workbooks'), { kind: 'error' });
      return;
    }
    setFolders((await folderResponse.json()) as Folder[]);
    setWorkbooks((await workbookResponse.json()) as Workbook[]);
    setTags((await tagResponse.json()) as Tag[]);
  }

  useEffect(() => setToken(localStorage.getItem('gtmai-token') ?? ''), []);
  useEffect(() => {
    if (token) void load();
  }, [token]);
  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  useEffect(() => {
    const query = searchText.trim();
    const active = Boolean(query || selectedTagIds.length);
    if (!active || !token) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (selectedTagIds.length) params.set('tagIds', selectedTagIds.join(','));
      void fetch(`${api}/search?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            toast(await responseMessage(response, 'Search failed'), { kind: 'error' });
            return null;
          }
          return (await response.json()) as SearchResults;
        })
        .then((results) => {
          if (results) setSearchResults(results);
        })
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchText, selectedTagIds, token]);

  const visibleWorkbooks = useMemo(
    () =>
      workbooks.filter(
        (workbook) =>
          (selectedFolder === null || workbook.folderId === selectedFolder) &&
          selectedTagIds.every((tagId) => workbook.tags.some((tag) => tag.id === tagId)),
      ),
    [selectedFolder, selectedTagIds, workbooks],
  );

  const searchActive = Boolean(searchText.trim() || selectedTagIds.length);

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }

  function clearSearch() {
    setSearchText('');
    setSelectedTagIds([]);
    setSearchResults(null);
  }

  function selectSearchFolder(folderId: string) {
    setSelectedFolder(folderId);
    clearSearch();
  }

  async function createFolder(parentId?: string | null) {
    const values = await dialog.prompt({
      title: 'New folder',
      fields: [{ name: 'name', label: 'Folder name' }],
      confirmLabel: 'Create folder',
    });
    if (!values?.name) return;
    const response = await fetch(`${api}/folders`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: values.name, parentId: parentId ?? undefined }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Folder creation failed'), { kind: 'error' });
      return;
    }
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
      const response = await fetch(`${api}/folders/${folder.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(token),
      });
      if (!response.ok) {
        toast(await responseMessage(response, 'Folder deletion failed'), { kind: 'error' });
        return;
      }
      if (selectedFolder === folder.id) setSelectedFolder(null);
      await load();
      return;
    }
    const values = await dialog.prompt({
      title: action === 'rename' ? 'Rename folder' : 'Move folder',
      fields: [
        action === 'rename'
          ? { name: 'name', label: 'Folder name', defaultValue: folder.name }
          : {
              name: 'parentId',
              label: 'Parent folder',
              defaultValue: folder.parentId ?? '',
              type: 'select' as const,
              options: [
                { value: '', label: 'Root folder' },
                ...folders
                  .filter((item) => item.id !== folder.id)
                  .map((item) => ({ value: item.id, label: item.name })),
              ],
            },
      ],
      confirmLabel: action === 'rename' ? 'Rename' : 'Move',
    });
    if (!values) return;
    const response = await fetch(`${api}/folders/${folder.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify(
        action === 'rename' ? { name: values.name } : { parentId: values.parentId || null },
      ),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Folder update failed'), { kind: 'error' });
      return;
    }
    await load();
  }

  async function createWorkbook() {
    const values = await dialog.prompt({
      title: 'New workbook',
      fields: [{ name: 'name', label: 'Workbook name' }],
      confirmLabel: 'Create workbook',
    });
    if (!values?.name) return;
    const response = await fetch(`${api}/workbooks`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: values.name, folderId: selectedFolder }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Workbook creation failed'), { kind: 'error' });
      return;
    }
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
      const response = await fetch(`${api}/workbooks/${workbook.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(token),
      });
      if (!response.ok) {
        toast(await responseMessage(response, 'Workbook deletion failed'), { kind: 'error' });
        return;
      }
      await load();
      return;
    }
    const values = await dialog.prompt({
      title: action === 'rename' ? 'Rename workbook' : 'Move workbook',
      fields: [
        action === 'rename'
          ? { name: 'name', label: 'Workbook name', defaultValue: workbook.name }
          : {
              name: 'folderId',
              label: 'Folder',
              defaultValue: workbook.folderId ?? '',
              type: 'select' as const,
              options: [
                { value: '', label: 'Unfiled' },
                ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
              ],
            },
      ],
      confirmLabel: action === 'rename' ? 'Rename' : 'Move',
    });
    if (!values) return;
    const response = await fetch(`${api}/workbooks/${workbook.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify(
        action === 'rename' ? { name: values.name } : { folderId: values.folderId || null },
      ),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Workbook update failed'), { kind: 'error' });
      return;
    }
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
          <div className="toolbar home-toolbar">
            <label className="home-search">
              <span className="sr-only">Search workbooks</span>
              <input
                value={searchText}
                placeholder="Search folders, workbooks, tables, tags…"
                onChange={(event) => setSearchText(event.target.value)}
              />
              {searchActive && (
                <button type="button" aria-label="Clear search" onClick={clearSearch}>
                  ×
                </button>
              )}
            </label>
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
            className={`chip ${selectedTagIds.length === 0 ? 'selected' : ''}`}
            onClick={() => setSelectedTagIds([])}
          >
            All tags
          </button>
          {tags.map((tag) => (
            <button
              className={`chip ${selectedTagIds.includes(tag.id) ? 'selected' : ''}`}
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
            >
              <span className="tag-dot" style={{ background: tag.color ?? '#6366f1' }} />
              {tag.name}
            </button>
          ))}
        </div>
        {searchActive ? (
          <SearchResultsView
            results={searchResults}
            searching={searching}
            onFolder={selectSearchFolder}
          />
        ) : (
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
                onMenu={(event, folder) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu((current) =>
                    current?.kind === 'folder' && current.item.id === folder.id
                      ? null
                      : {
                          kind: 'folder',
                          item: folder,
                          top: rect.bottom + 4,
                          left: rect.right - 130,
                        },
                  );
                }}
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
                    <button
                      className="icon-button"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenu((current) =>
                          current?.kind === 'workbook' && current.item.id === workbook.id
                            ? null
                            : {
                                kind: 'workbook',
                                item: workbook,
                                top: rect.bottom + 4,
                                left: rect.right - 130,
                              },
                        );
                      }}
                    >
                      ⋮
                    </button>
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
                    onTagCreated={() => void load()}
                  />
                </article>
              ))}
              {!visibleWorkbooks.length && (
                <div className="empty-state">No workbooks in this view.</div>
              )}
            </div>
          </div>
        )}
      </section>
      {menu && (
        <div
          className="card-menu-items floating-menu"
          ref={menuRef}
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.kind === 'folder' ? (
            <>
              <button
                onClick={() => {
                  setMenu(null);
                  void editFolder(menu.item, 'rename');
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void editFolder(menu.item, 'move');
                }}
              >
                Move
              </button>
              <TagPicker
                target={{ type: 'folderId', id: menu.item.id }}
                selected={menu.item.tags}
                onChange={(tags) => {
                  setFolders((current) =>
                    current.map((item) => (item.id === menu.item.id ? { ...item, tags } : item)),
                  );
                }}
                onTagCreated={() => void load()}
              />
              <button
                onClick={() => {
                  setMenu(null);
                  void editFolder(menu.item, 'delete');
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setMenu(null);
                  void editWorkbook(menu.item, 'rename');
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void editWorkbook(menu.item, 'move');
                }}
              >
                Move
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void editWorkbook(menu.item, 'delete');
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}

function SearchResultsView({
  results,
  searching,
  onFolder,
}: {
  results: SearchResults | null;
  searching: boolean;
  onFolder: (folderId: string) => void;
}) {
  if (searching && !results) return <div className="empty-state">Searching…</div>;
  if (!results) return null;
  const groups: Array<{ label: string; items: SearchResult[] }> = [
    { label: 'Folders', items: results.folders },
    { label: 'Workbooks', items: results.workbooks },
    { label: 'Tables', items: results.tables },
  ];
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  if (!count) return <div className="empty-state">No results</div>;

  return (
    <div className="search-results">
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section className="search-result-group" key={group.label}>
              <h3>{group.label}</h3>
              <div className="search-result-list">
                {group.items.map((item) => {
                  const breadcrumb =
                    item.kind === 'table'
                      ? [item.folderName, item.workbookName].filter(Boolean).join(' › ')
                      : item.folderName;
                  const content = (
                    <>
                      <span className="search-result-icon">
                        {item.kind === 'folder' ? '▰' : item.kind === 'workbook' ? '▤' : '▦'}
                      </span>
                      <span className="search-result-copy">
                        <strong>{item.name}</strong>
                        {breadcrumb && <small>{breadcrumb}</small>}
                        <span className="search-result-tags">
                          {item.tags.map((tag) => (
                            <span className="chip" key={tag.id}>
                              <span
                                className="tag-dot"
                                style={{ background: tag.color ?? '#6366f1' }}
                              />
                              {tag.name}
                            </span>
                          ))}
                        </span>
                      </span>
                    </>
                  );
                  if (item.kind === 'folder') {
                    return (
                      <button
                        className="search-result-row"
                        key={item.id}
                        onClick={() => onFolder(item.id)}
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <a
                      className="search-result-row"
                      href={`/${item.kind === 'workbook' ? 'workbooks' : 'tables'}/${item.id}`}
                      key={item.id}
                    >
                      {content}
                    </a>
                  );
                })}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

function jsonHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function responseMessage(response: Response | undefined, fallback: string): Promise<string> {
  if (!response) return fallback;
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function FolderTree({
  folders,
  parentId,
  selectedFolder,
  collapsed,
  onSelect,
  onToggle,
  onMenu,
}: {
  folders: Folder[];
  parentId: string | null;
  selectedFolder: string | null;
  collapsed: string[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onMenu: (event: ReactMouseEvent<HTMLButtonElement>, folder: Folder) => void;
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
                <button className="folder-more" onClick={(event) => onMenu(event, folder)}>
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
                  onMenu={onMenu}
                />
              )}
            </div>
          );
        })}
    </>
  );
}
