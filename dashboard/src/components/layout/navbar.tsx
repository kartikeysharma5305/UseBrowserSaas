'use client';

import Link from 'next/link';
import { Menu, Search } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { Button } from '@/components/ui/button';

type NavbarProps = {
  userName: string;
  userEmail: string;
  onOpenMobileNav: () => void;
};

export function Navbar({ userName, userEmail, onOpenMobileNav }: NavbarProps) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
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

          <div className="hidden rounded-lg border border-slate-200 px-3 py-2 lg:flex lg:items-center lg:gap-2">
            <Search className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-500">Search agents</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-slate-900">{userName}</p>
            <p className="text-xs text-slate-500">{userEmail}</p>
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
