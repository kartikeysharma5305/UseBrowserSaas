import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { formatDate } from '@/lib/utils/format-date';
import { formatRunResult } from '@/lib/utils/format-run-result';
import type { RunRecord } from '@/lib/types';

type RunTableProps = {
  runs: RunRecord[];
};

export function RunTable({ runs }: RunTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Completed</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {runs.map((run) => (
              <tr
                key={run.id}
                className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-4 font-medium text-slate-900 dark:text-slate-100">
                  {run.agent?.name ?? 'Unknown agent'}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {formatDate(run.startedAt)}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {run.completedAt ? formatDate(run.completedAt) : '—'}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {run.duration ?? '—'}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {formatRunResult(run.result)}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/dashboard/runs/${run.id}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-label={`View details for ${run.agent?.name ?? 'run'}`}
                    title="View run details"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
import Link from 'next/link';
import { Eye } from 'lucide-react';
