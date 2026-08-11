import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
};

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        {
          default:
            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
          success:
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
          warning:
            'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
          danger:
            'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
          info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
        }[tone],
        className
      )}
      {...props}
    />
  );
}
