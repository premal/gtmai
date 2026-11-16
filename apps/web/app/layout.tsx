import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import type { ReactNode } from 'react';
import { AuthGuard } from './auth';
import { DialogProvider } from './components/prompt-dialog';
import { ToastProvider } from './components/toast';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Leadsmith', template: '%s · Leadsmith' },
  description: 'A spreadsheet that fills itself — enrichment waterfalls, AI research and outbound',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ToastProvider>
          <DialogProvider>
            <AuthGuard>{children}</AuthGuard>
          </DialogProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
