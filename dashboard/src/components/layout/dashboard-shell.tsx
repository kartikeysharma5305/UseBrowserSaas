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
};

/**
 * DashboardShell component provides the main layout for authenticated pages
 *
 * Layout Structure:
 * - Sidebar (always visible on desktop, hidden on mobile)
 * - MobileNavigation (drawer that slides in from left on mobile)
 * - Navbar (top navigation with user menu)
 * - Main content area (children)
 *
 * Responsive behavior:
 * - Desktop (lg+): Sidebar visible, mobile nav drawer hidden
 * - Mobile (<lg): Sidebar hidden, nav drawer toggleable via navbar hamburger
 */
export function DashboardShell({ user, children }: DashboardShellProps) {
  // Track mobile drawer state - toggled by navbar hamburger button
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop sidebar - visible on lg+ breakpoint */}
      <Sidebar />

      {/* Mobile navigation drawer - slides in from left */}
      <MobileNavigation
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      {/* Main content area */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top navigation with user menu and mobile hamburger */}
        <Navbar
          userName={user.name ?? user.email ?? 'Authenticated user'}
          userEmail={user.email ?? 'No email'}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        {/* Page content with responsive padding */}
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
