import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
};

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        {
          default: 'bg-slate-100 text-slate-700',
          success: 'bg-emerald-100 text-emerald-700',
          warning: 'bg-amber-100 text-amber-700',
          danger: 'bg-rose-100 text-rose-700',
          info: 'bg-sky-100 text-sky-700',
        }[tone],
        className
      )}
      {...props}
    />
  );
}
