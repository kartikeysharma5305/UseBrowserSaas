'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Agent = {
  id: string;
  name: string;
  description?: string | null;
  goal: string;
  targetWebsite: string;
  status: string;
  configuration?: {
    model?: string;
    maxSteps?: number;
    timeoutMs?: number;
    browserSettings?: {
      headless?: boolean;
      viewportWidth?: number;
      viewportHeight?: number;
    };
  } | null;
};

type Run = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  duration?: number | null;
  result?: string | null;
  agent?: {
    id?: string;
    name?: string;
  } | null;
};

export function AgentDetailClient({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAgentDetails() {
    try {
      const [agentResponse, runsResponse] = await Promise.all([
        fetch(`/api/agents/${id}`),
        fetch('/api/runs'),
      ]);

      if (!agentResponse.ok || !runsResponse.ok) {
        throw new Error('Unable to load agent details.');
      }

      const [agentPayload, runsPayload] = await Promise.all([
        agentResponse.json(),
        runsResponse.json(),
      ]);

      const currentAgent = agentPayload?.data ?? null;
      const allRuns = Array.isArray(runsPayload?.data) ? runsPayload.data : [];
      const filteredRuns = allRuns.filter((run: Run) => run.agent?.id === id);

      setAgent(currentAgent);
      setRuns(filteredRuns);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load agent details.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgentDetails();
  }, [id]);

  async function runAgent() {
    try {
      const response = await fetch(`/api/agents/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to run agent.');
      }

      await loadAgentDetails();
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : 'Unable to run agent.'
      );
    }
  }

  async function deleteAgent() {
    const confirmed = window.confirm('Delete this agent?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to delete agent.');
      }

      window.location.href = '/dashboard/agents';
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

  if (!agent) {
    return (
      <EmptyState
        title="Agent not found"
        description="The requested agent could not be loaded."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Agent detail</p>
          <h1 className="text-3xl font-semibold text-slate-900">
            {agent.name}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={runAgent}>
            Run Agent
          </Button>
          <Button variant="danger" onClick={deleteAgent}>
            Delete Agent
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={agent.status} />
            </div>
            <div>
              <p className="text-sm text-slate-500">Goal</p>
              <p className="text-sm text-slate-900">{agent.goal}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Website</p>
              <p className="text-sm text-slate-900">{agent.targetWebsite}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Description</p>
              <p className="text-sm text-slate-900">
                {agent.description ?? 'No description provided.'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-slate-900">
            Configuration
          </h2>
          <dl className="mt-3 space-y-2 text-sm text-slate-600">
            <div className="flex justify-between gap-3">
              <dt>Model</dt>
              <dd className="font-medium text-slate-900">
                {agent.configuration?.model ?? 'Unknown'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Max Steps</dt>
              <dd className="font-medium text-slate-900">
                {agent.configuration?.maxSteps ?? 'Unknown'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Timeout</dt>
              <dd className="font-medium text-slate-900">
                {agent.configuration?.timeoutMs ?? 'Unknown'} ms
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Headless</dt>
              <dd className="font-medium text-slate-900">
                {agent.configuration?.browserSettings?.headless ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900">
          Execution history
        </h2>
        <div className="mt-4 space-y-3">
          {runs.length === 0 ? (
            <EmptyState
              title="No execution history"
              description="This agent has not run yet."
            />
          ) : (
            runs.map((run) => (
              <div
                key={run.id}
                className="rounded-xl border border-slate-200 px-4 py-3"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {new Date(run.startedAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">
                      Completed:{' '}
                      {run.completedAt
                        ? new Date(run.completedAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="text-sm text-slate-600">
                      {run.duration ?? '—'} ms
                    </span>
                    <span className="text-sm text-slate-600">
                      {run.result ?? 'No result'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
