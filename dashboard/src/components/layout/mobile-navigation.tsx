'use client';

import Link from 'next/link';
import { X, LayoutDashboard, Bot, History, Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const navigation = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot },
  { href: '/dashboard/runs', label: 'Runs', icon: History },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function MobileNavigation({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 bg-slate-950/40 transition-opacity lg:hidden',
        open ? 'visible opacity-100' : 'invisible opacity-0'
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-72 bg-slate-950 text-slate-100 transition-transform',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
              Browser Use
            </p>
            <h2 className="text-lg font-semibold">SaaS Dashboard</h2>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="p-3">
          <ul className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    )}
                    onClick={onClose}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
