import './globals.css';
import type { ReactNode } from 'react';
import { AuthGuard } from './auth';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
