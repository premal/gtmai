'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from './toast';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const colors = [
  '#6366f1',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#06b6d4',
  '#eab308',
  '#8b5cf6',
  '#ef4444',
];
type Tag = { id: string; name: string; color?: string | null };

export function TagPicker({
  target,
  selected,
  onChange,
  onTagCreated,
}: {
  target: { type: 'folderId' | 'workbookId' | 'tableId'; id: string };
  selected: Tag[];
  onChange: (tags: Tag[]) => void;
  onTagCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState<Tag[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(colors[0]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const token = typeof window === 'undefined' ? '' : (localStorage.getItem('gtmai-token') ?? '');
  const { toast } = useToast();
  const matches = useMemo(
    () => available.filter((tag) => tag.name.toLowerCase().includes(query.toLowerCase())),
    [available, query],
  );

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  async function openPicker() {
    setOpen((value) => !value);
    if (available.length) return;
    const response = await fetch(`${api}/tags`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to load tags'), { kind: 'error' });
      return;
    }
    setAvailable((await response.json()) as Tag[]);
  }

  async function assign(tag: Tag) {
    if (selected.some((item) => item.id === tag.id)) return;
    const response = await fetch(`${api}/tags/${tag.id}/assign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ [target.type]: target.id }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to assign tag'), { kind: 'error' });
      return;
    }
    onChange([...selected, tag]);
  }

  async function createAndAssign() {
    if (!newName.trim()) return;
    const response = await fetch(`${api}/tags`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to create tag'), { kind: 'error' });
      return;
    }
    const tag = (await response.json()) as Tag;
    setAvailable((current) => [...current, tag]);
    setNewName('');
    await assign(tag);
    onTagCreated?.();
  }

  async function remove(tag: Tag) {
    const response = await fetch(`${api}/tags/${tag.id}/unassign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ [target.type]: target.id }),
    });
    if (!response.ok) {
      toast(await responseMessage(response, 'Unable to remove tag'), { kind: 'error' });
      return;
    }
    onChange(selected.filter((item) => item.id !== tag.id));
  }

  return (
    <div className="tag-picker" ref={pickerRef}>
      <div className="tag-chip-list">
        {selected.map((tag) => (
          <button className="tag-chip" key={tag.id} onClick={() => void remove(tag)}>
            <span style={{ background: tag.color ?? colors[0] }} />
            {tag.name} ×
          </button>
        ))}
        <button className="button compact" onClick={() => void openPicker()}>
          + Tag
        </button>
      </div>
      {open && (
        <div className="tag-picker-popover">
          <input
            placeholder="Search tags"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="tag-options">
            {matches.map((tag) => (
              <button key={tag.id} onClick={() => void assign(tag)}>
                <span style={{ background: tag.color ?? colors[0] }} />
                {tag.name}
              </button>
            ))}
          </div>
          <div className="tag-create">
            <input
              placeholder="Create tag"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <div className="color-options">
              {colors.map((color) => (
                <button
                  className="color-dot"
                  key={color}
                  style={{
                    background: color,
                    outline: newColor === color ? '2px solid #182235' : '',
                  }}
                  onClick={() => setNewColor(color)}
                  aria-label={`Use ${color}`}
                />
              ))}
            </div>
            <button className="button primary compact" onClick={() => void createAndAssign()}>
              Create
            </button>
          </div>
        </div>
      )}
    </div>
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
