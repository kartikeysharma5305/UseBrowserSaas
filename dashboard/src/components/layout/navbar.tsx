'use client';

import Link from 'next/link';
import { Menu, Search, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { LogoutButton } from '@/components/auth/logout-button';
import { Button } from '@/components/ui/button';

type NavbarProps = {
  userName: string;
  userEmail: string;
  onOpenMobileNav: () => void;
};

export function Navbar({ userName, userEmail, onOpenMobileNav }: NavbarProps) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            className="lg:hidden"
            onClick={onOpenMobileNav}
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="hidden rounded-lg border border-slate-200 px-3 py-2 lg:flex lg:items-center lg:gap-2 dark:border-slate-700">
            <Search className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Search agents
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {userName}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {userEmail}
            </p>
          </div>
          <Link href="/dashboard/agents/create">
            <Button variant="secondary">New Agent</Button>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
