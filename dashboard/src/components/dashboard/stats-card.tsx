import { Card } from '@/components/ui/card';

export function StatsCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {value}
        </h3>
        {detail ? (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {detail}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
