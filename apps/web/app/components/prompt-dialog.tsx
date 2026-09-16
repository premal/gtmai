'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { FormEvent } from 'react';

export type PromptField = {
  name: string;
  label: string;
  defaultValue?: string;
  multiline?: boolean;
};
export type PromptOptions = {
  title: string;
  description?: string;
  fields: PromptField[];
  confirmLabel: string;
  danger?: boolean;
};
type ConfirmOptions = Omit<PromptOptions, 'fields'>;
type DialogContextValue = {
  prompt: (options: PromptOptions) => Promise<Record<string, string> | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};
type Request =
  | {
      type: 'prompt';
      options: PromptOptions;
      resolve: (value: Record<string, string> | null) => void;
    }
  | { type: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void };

const DialogContext = createContext<DialogContextValue | null>(null);

export function PromptDialog({
  title,
  description,
  fields,
  confirmLabel,
  danger,
  eyebrow = 'CONFIRMATION',
  onSubmit,
  onCancel,
}: PromptOptions & {
  eyebrow?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ''])),
  );
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    for (const field of fields) {
      if (!field.multiline) continue;
      try {
        const parsed = JSON.parse(values[field.name] ?? '');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('JSON must be an object');
      } catch {
        setError(`${field.label} must be valid JSON object`);
        return;
      }
    }
    await onSubmit(values);
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="card-header">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h3>{title}</h3>
          </div>
        </div>
        {description && <p className="muted">{description}</p>}
        <form onSubmit={(event) => void submit(event)}>
          {fields.map((field) => (
            <label className="field-label" key={field.name}>
              {field.label}
              {field.multiline ? (
                <textarea
                  className="input"
                  rows={7}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              ) : (
                <input
                  className="input"
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              )}
            </label>
          ))}
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={`button primary${danger ? ' danger' : ''}`}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  function prompt(options: PromptOptions) {
    return new Promise<Record<string, string> | null>((resolve) => {
      setRequest({ type: 'prompt', options, resolve });
    });
  }
  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      setRequest({ type: 'confirm', options, resolve });
    });
  }
  function cancel() {
    if (!request) return;
    if (request.type === 'prompt') request.resolve(null);
    else request.resolve(false);
    setRequest(null);
  }
  const value = { prompt, confirm };
  return (
    <DialogContext.Provider value={value}>
      {children}
      {request?.type === 'prompt' && (
        <PromptDialog
          {...request.options}
          eyebrow="Input"
          onSubmit={(values) => {
            request.resolve(values);
            setRequest(null);
          }}
          onCancel={cancel}
        />
      )}
      {request?.type === 'confirm' && (
        <PromptDialog
          {...request.options}
          fields={[]}
          eyebrow="Confirm"
          onSubmit={() => {
            request.resolve(true);
            setRequest(null);
          }}
          onCancel={cancel}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within DialogProvider');
  return context;
}
