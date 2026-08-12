'use client';

import Link from 'next/link';
import {
  X,
  LayoutDashboard,
  Bot,
  History,
  Settings,
  Gauge,
  CreditCard,
  CalendarClock,
  Bell,
  LayoutTemplate,
  MessageSquare,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const navigation = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot },
  { href: '/dashboard/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/dashboard/runs', label: 'Runs', icon: History },
  { href: '/dashboard/schedules', label: 'Scheduling', icon: CalendarClock },
  { href: '/dashboard/usage', label: 'Usage', icon: Gauge },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/feedback', label: 'Beta feedback', icon: MessageSquare },
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
        'fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity lg:hidden',
        open ? 'visible opacity-100' : 'invisible opacity-0'
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-72 bg-white shadow-xl transition-transform dark:bg-slate-900',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Browser Use
            </p>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Dashboard
            </h2>
          </div>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close navigation"
          >
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
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
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
      </div>
    </div>
  );
}
