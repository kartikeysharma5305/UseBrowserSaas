'use client';

import Link from 'next/link';
import { LayoutDashboard, Bot, History, Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

const navigation = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot },
  { href: '/dashboard/runs', label: 'Runs', icon: History },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-slate-950 text-slate-100 lg:block">
      <div className="border-b border-slate-800 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
          Browser Use
        </p>
        <h1 className="mt-1 text-lg font-semibold">SaaS Dashboard</h1>
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
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
