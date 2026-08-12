import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { formatDate } from '@/lib/utils/format-date';

type AgentTableProps = {
  agents: Array<{
    id: string;
    name: string;
    description?: string | null;
    targetWebsite: string;
    status: string;
    createdAt: string;
    lastRunAt?: string | null;
  }>;
  onRun?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
  runningAgentIds?: ReadonlySet<string>;
};

export function AgentTable({
  agents,
  onRun,
  onDelete,
  runningAgentIds = new Set(),
}: AgentTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Website</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last Run</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {agents.map((agent) => (
              <tr
                key={agent.id}
                className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-4">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {agent.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {agent.description ?? 'No description'}
                    </p>
                  </div>
                </td>
                <td className="max-w-xs px-4 py-4 text-slate-600 dark:text-slate-400">
                  <span className="block truncate" title={agent.targetWebsite}>
                    {agent.targetWebsite}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <StatusBadge status={agent.status} />
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {formatDate(agent.createdAt)}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {agent.lastRunAt ? formatDate(agent.lastRunAt) : 'Never'}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => onRun?.(agent.id)}
                      disabled={runningAgentIds.has(agent.id)}
                    >
                      {runningAgentIds.has(agent.id) ? 'Starting...' : 'Run'}
                    </Button>
                    <Link href={`/dashboard/agents/${agent.id}`}>
                      <Button variant="ghost">View</Button>
                    </Link>
                    <Button
                      variant="danger"
                      onClick={() => onDelete?.(agent.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
