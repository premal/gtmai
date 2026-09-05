import './globals.css';
import type { ReactNode } from 'react';
import { AuthGuard } from './auth';
import { DialogProvider } from './components/prompt-dialog';
import { ToastProvider } from './components/toast';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <DialogProvider>
            <AuthGuard>{children}</AuthGuard>
          </DialogProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
