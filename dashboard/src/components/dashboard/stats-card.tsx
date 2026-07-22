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
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="text-3xl font-semibold text-slate-900">{value}</h3>
        {detail ? (
          <span className="text-xs text-slate-500">{detail}</span>
        ) : null}
      </div>
    </Card>
  );
}
