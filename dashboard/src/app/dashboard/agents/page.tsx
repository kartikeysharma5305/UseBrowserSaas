'use client';

import { useEffect, useState } from 'react';

import { AgentTable } from '@/components/dashboard/agent-table';
import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';

type Agent = {
  id: string;
  name: string;
  description?: string | null;
  targetWebsite: string;
  status: string;
  createdAt: string;
  lastRunAt?: string | null;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAgents() {
    try {
      const response = await fetch('/api/agents');

      if (!response.ok) {
        throw new Error('Unable to load agents.');
      }

      const payload = await response.json();
      setAgents(Array.isArray(payload?.data) ? payload.data : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load agents.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  async function runAgent(agentId: string) {
    try {
      const response = await fetch(`/api/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to run agent.');
      }

      await loadAgents();
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : 'Unable to run agent.'
      );
    }
  }

  async function deleteAgent(agentId: string) {
    const confirmed = window.confirm('Delete this agent?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to delete agent.');
      }

      await loadAgents();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete agent.'
      );
    }
  }

  if (loading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Agent management</p>
          <h1 className="text-3xl font-semibold text-slate-900">Agents</h1>
        </div>
        <a href="/dashboard/agents/create">
          <Button variant="primary">Create Agent</Button>
        </a>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title="No agents created yet"
          description="Create your first browser automation agent to get started."
          action={
            <a href="/dashboard/agents/create">
              <Button variant="primary">Create an agent</Button>
            </a>
          }
        />
      ) : (
        <AgentTable agents={agents} onRun={runAgent} onDelete={deleteAgent} />
      )}
    </div>
  );
}
