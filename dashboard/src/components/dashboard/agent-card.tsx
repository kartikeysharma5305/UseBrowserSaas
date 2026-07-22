import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';

type AgentCardProps = {
  id: string;
  name: string;
  description?: string | null;
  targetWebsite: string;
  status: string;
  lastRunAt?: string | null;
  onRun?: () => void;
  onDelete?: () => void;
};

export function AgentCard({
  id,
  name,
  description,
  targetWebsite,
  status,
  lastRunAt,
  onRun,
  onDelete,
}: AgentCardProps) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{name}</h3>
            <StatusBadge status={status} />
          </div>
          {description ? (
            <p className="mt-2 text-sm text-slate-600">{description}</p>
          ) : null}
          <div className="mt-3 space-y-1 text-sm text-slate-500">
            <p>
              <span className="font-medium text-slate-700">Website:</span>{' '}
              {targetWebsite}
            </p>
            <p>
              <span className="font-medium text-slate-700">Last run:</span>{' '}
              {lastRunAt ? new Date(lastRunAt).toLocaleString() : 'Never'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRun}>
            Run
          </Button>
          <Link href={`/dashboard/agents/${id}`}>
            <Button variant="ghost">View</Button>
          </Link>
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
