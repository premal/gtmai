'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'error';
type ToastOptions = { kind?: ToastKind };
type ToastItem = { id: number; message: string; kind: ToastKind };
type ToastContextValue = { toast: (message: string, options?: ToastOptions) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function Toast({ message, kind }: { message: string; kind: ToastKind }) {
  return <div className={`toast${kind === 'error' ? ' error' : ''}`}>{message}</div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = Date.now() + Math.random();
    const item = { id, message, kind: options.kind ?? 'info' };
    setItems((current) => [...current, item]);
    window.setTimeout(() => {
      setItems((current) => current.filter((toastItem) => toastItem.id !== id));
    }, 4000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <Toast key={item.id} message={item.message} kind={item.kind} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
