import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';

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
};

export function AgentTable({ agents, onRun, onDelete }: AgentTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Website</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last Run</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id} className="border-t border-slate-200">
                <td className="px-4 py-4">
                  <div>
                    <p className="font-medium text-slate-900">{agent.name}</p>
                    <p className="text-xs text-slate-500">
                      {agent.description ?? 'No description'}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {agent.targetWebsite}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge status={agent.status} />
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {new Date(agent.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {agent.lastRunAt
                    ? new Date(agent.lastRunAt).toLocaleString()
                    : 'Never'}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => onRun?.(agent.id)}
                    >
                      Run
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
