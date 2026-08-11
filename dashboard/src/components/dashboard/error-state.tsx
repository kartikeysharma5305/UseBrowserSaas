import { Card } from '@/components/ui/card';

export function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-rose-200 bg-rose-50 p-6 dark:border-rose-900/60 dark:bg-rose-950/40">
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
            Something went wrong
          </p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">
            {message}
          </p>
        </div>
      </div>
    </Card>
  );
}
