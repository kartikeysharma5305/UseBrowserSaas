import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';

type RunTableProps = {
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string | null;
    duration?: number | null;
    result?: string | null;
    agent?: { name?: string } | null;
  }>;
};

export function RunTable({ runs }: RunTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Completed</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-slate-200">
                <td className="px-4 py-4 font-medium text-slate-900">
                  {run.agent?.name ?? 'Unknown agent'}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {run.completedAt
                    ? new Date(run.completedAt).toLocaleString()
                    : 'In progress'}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {run.duration ?? '—'}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {run.result ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
