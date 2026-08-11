'use client';

import { useState, type ReactNode } from 'react';

import { MobileNavigation } from '@/components/layout/mobile-navigation';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';

type DashboardShellProps = {
  user: {
    name?: string | null;
    email?: string | null;
  };
  children: ReactNode;
  beta?: { status: string; releaseId: string; supportEmail: string } | null;
};

export function DashboardShell({ user, children, beta }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />

      <MobileNavigation
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <div className="flex min-h-screen flex-1 flex-col">
        <Navbar
          userName={user.name ?? user.email ?? 'Authenticated user'}
          userEmail={user.email ?? 'No email'}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        {beta ? (
          <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-center text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
            Closed beta · release {beta.releaseId}
            {beta.status === 'SUSPENDED'
              ? ' · execution access suspended'
              : beta.status === 'ENDED'
                ? ' · beta access ended'
                : ''}{' '}
            ·{' '}
            <a className="underline" href={`mailto:${beta.supportEmail}`}>
              Support
            </a>{' '}
            ·{' '}
            <a className="underline" href="/dashboard/feedback">
              Feedback
            </a>
          </div>
        ) : null}
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
