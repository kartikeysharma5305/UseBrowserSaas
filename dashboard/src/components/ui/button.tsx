import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        [
          'inline-flex items-center justify-center rounded-lg px-3.5 py-2',
          'text-sm font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-slate-300',
          'disabled:cursor-not-allowed disabled:opacity-60',
          {
            primary: 'bg-slate-900 text-white hover:bg-slate-800',
            secondary:
              'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            danger: 'bg-rose-600 text-white hover:bg-rose-700',
          }[variant],
        ].join(' '),
        className
      )}
      {...props}
    />
  );
}
