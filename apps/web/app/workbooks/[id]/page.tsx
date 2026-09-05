'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '../../app-nav';
import { TagPicker } from '../../components/tag-picker';
import { useDialog } from '../../components/prompt-dialog';
import { TableWorkspace } from '../../components/table-workspace';
import { useToast } from '../../components/toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Tag = { id: string; name: string; color?: string | null };
type TableSummary = {
  id: string;
  name: string;
  position: number;
  _count: { rows: number; columns: number };
};
type Workbook = {
  id: string;
  name: string;
  folderId?: string | null;
  folder?: { id: string; name: string } | null;
  tags: Tag[];
  tables: TableSummary[];
};
type Template = { id: string; name: string; kind: string };

export default function WorkbookPage({ params }: { params: Promise<{ id: string }> }) {
  const [workbookId, setWorkbookId] = useState('');
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeTableId, setActiveTableId] = useState('');
  const [menu, setMenu] = useState<{ tableId: string; top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialog = useDialog();
  const { toast } = useToast();
  const router = useRouter();
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');

  useEffect(() => {
    void params.then(({ id }) => setWorkbookId(id));
  }, [params]);
  async function load() {
    if (!workbookId) return;
    const headers = { authorization: `Bearer ${token}` };
    const [response, allResponse] = await Promise.all([
      fetch(`${api}/workbooks/${workbookId}`, { headers }),
      fetch(`${api}/workbooks`, { headers }),
    ]);
    if (!response.ok || !allResponse.ok) {
      const failed = !response.ok ? response : allResponse;
      toast(await responseMessage(failed, 'Unable to load workbook'), { kind: 'error' });
      return;
    }
    const next = (await response.json()) as Workbook;
    setWorkbook(next);
    setWorkbooks((await allResponse.json()) as Workbook[]);
    if (!activeTableId || !next.tables.some((table) => table.id === activeTableId))
      setActiveTableId(next.tables[0]?.id ?? '');
  }
  useEffect(() => {
    if (workbookId && token) void load();
  }, [workbookId, token]);
  useEffect(() => {
    if (!token) return;
    void fetch(`${api}/templates`, { headers: { authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) {
          toast(await responseMessage(response, 'Unable to load templates'), { kind: 'error' });
          return [];
        }
        return (await response.json()) as Template[];
      })
      .then((items) => setTemplates(items.filter((item) => item.kind === 'table')));
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

  const folderName = useMemo(
    () => workbook?.folder?.name ?? 'All workbooks',
    [workbook?.folder?.name],
  );

  async function renameWorkbook() {
    if (!workbook) return;
    const values = await dialog.prompt({
      title: 'Rename workbook',
      fields: [{ name: 'name', label: 'Workbook name', defaultValue: workbook.name }],
      confirmLabel: 'Rename',
    });
    if (!values?.name) return;
    const response = await fetch(`${api}/workbooks/${workbook.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: values.name }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to rename workbook'), { kind: 'error' });
      return;
    }
    await load();
  }

  async function addTable() {
    const values = await dialog.prompt({
      title: 'Add table',
      fields: [
        { name: 'name', label: 'Table name', defaultValue: 'New table' },
        {
          name: 'templateId',
          label: `Template ID (optional: ${templates
            .slice(0, 3)
            .map((item) => item.id)
            .join(', ')})`,
        },
      ],
      confirmLabel: 'Create table',
    });
    if (!values) return;
    const endpoint = values.templateId
      ? `${api}/templates/${values.templateId}/instantiate`
      : `${api}/tables`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        name: values.name,
        workbookId: workbookId,
      }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to create table'), { kind: 'error' });
      return;
    }
    const result = (await response.json()) as { id?: string; tableId?: string };
    await load();
    setActiveTableId(result.id ?? result.tableId ?? '');
  }

  async function updateTable(table: TableSummary, action: 'rename' | 'move' | 'delete') {
    if (action === 'delete') {
      if (
        !(await dialog.confirm({
          title: 'Delete table',
          description: `Delete ${table.name}?`,
          confirmLabel: 'Delete table',
          danger: true,
        }))
      )
        return;
      const response = await fetch(`${api}/tables/${table.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(token),
      });
      if (!response.ok) {
        toast(await responseMessage(response, 'Unable to delete table'), { kind: 'error' });
        return;
      }
      await load();
      return;
    }
    if (action === 'rename') {
      const values = await dialog.prompt({
        title: 'Rename table',
        fields: [{ name: 'name', label: 'Table name', defaultValue: table.name }],
        confirmLabel: 'Rename',
      });
      if (!values?.name) return;
      const response = await fetch(`${api}/tables/${table.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ name: values.name }),
      });
      if (!response.ok) {
        toast(await responseMessage(response, 'Unable to rename table'), { kind: 'error' });
        return;
      }
    } else {
      const values = await dialog.prompt({
        title: 'Move table',
        fields: [
          {
            name: 'workbookId',
            label: 'Destination workbook',
            defaultValue: workbookId,
            type: 'select',
            options: workbooks.map((item) => ({ value: item.id, label: item.name })),
          },
        ],
        confirmLabel: 'Move',
      });
      if (!values?.workbookId) return;
      const response = await fetch(`${api}/tables/${table.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ workbookId: values.workbookId }),
      });
      if (!response.ok) {
        toast(await responseMessage(response, 'Unable to move table'), { kind: 'error' });
        return;
      }
    }
    await load();
  }

  async function moveTable(table: TableSummary, direction: -1 | 1) {
    const index = workbook?.tables.findIndex((item) => item.id === table.id) ?? -1;
    const next = workbook?.tables[index + direction];
    if (!next) return;
    const firstResponse = await fetch(`${api}/tables/${table.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ position: next.position }),
    });
    if (!firstResponse.ok) {
      toast(await responseMessage(firstResponse, 'Unable to reorder table'), { kind: 'error' });
      return;
    }
    const secondResponse = await fetch(`${api}/tables/${next.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ position: table.position }),
    });
    if (!secondResponse.ok) {
      toast(await responseMessage(secondResponse, 'Unable to reorder table'), { kind: 'error' });
      return;
    }
    await load();
  }

  if (!workbook) return <main className="loading">Loading workbook…</main>;
  return (
    <main className="app-shell">
      <AppNav>
        <a className="back-link" href="/">
          ← All workbooks
        </a>
        <div className="sidebar-section">WORKBOOK</div>
        <div className="current-table">▤ {workbook.name}</div>
      </AppNav>
      <section className="content wide">
        <header className="topbar workbook-header">
          <div>
            <div className="eyebrow">
              <a href="/">WORKBOOKS</a> / {folderName.toUpperCase()} / {workbook.name.toUpperCase()}
            </div>
            <h2>
              {workbook.name}{' '}
              <button className="icon-button" onClick={() => void renameWorkbook()}>
                ✎
              </button>
            </h2>
            <TagPicker
              target={{ type: 'workbookId', id: workbook.id }}
              selected={workbook.tags}
              onChange={(tags) => setWorkbook({ ...workbook, tags })}
            />
          </div>
          <button className="button" onClick={() => router.push('/')}>
            Browse workbooks
          </button>
        </header>
        <div className="table-tabs">
          {workbook.tables.map((table, index) => (
            <div
              className={`table-tab ${activeTableId === table.id ? 'active' : ''}`}
              key={table.id}
            >
              <button onClick={() => setActiveTableId(table.id)}>
                ▦ {table.name}
                <small>{table._count.rows}</small>
              </button>
              <button
                className="icon-button"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu((current) =>
                    current?.tableId === table.id
                      ? null
                      : { tableId: table.id, top: rect.bottom + 4, left: rect.right - 130 },
                  );
                }}
              >
                ⋮
              </button>
            </div>
          ))}
          <button className="table-tab add" onClick={() => void addTable()}>
            ＋ Add table
          </button>
        </div>
        {activeTableId ? (
          <TableWorkspace key={activeTableId} tableId={activeTableId} embedded />
        ) : (
          <div className="empty-state">Add a table to start working in this workbook.</div>
        )}
      </section>
      {menu && (
        <div
          className="card-menu-items floating-menu"
          ref={menuRef}
          style={{ top: menu.top, left: menu.left }}
        >
          {(() => {
            const table = workbook.tables.find((item) => item.id === menu.tableId);
            if (!table) return null;
            const index = workbook.tables.findIndex((item) => item.id === table.id);
            return (
              <>
                <button
                  onClick={() => {
                    setMenu(null);
                    void updateTable(table, 'rename');
                  }}
                >
                  Rename
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void updateTable(table, 'move');
                  }}
                >
                  Move
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void moveTable(table, -1);
                  }}
                  disabled={index === 0}
                >
                  Move left
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void moveTable(table, 1);
                  }}
                  disabled={index === workbook.tables.length - 1}
                >
                  Move right
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void updateTable(table, 'delete');
                  }}
                >
                  Delete
                </button>
              </>
            );
          })()}
        </div>
      )}
    </main>
  );
}

function jsonHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
