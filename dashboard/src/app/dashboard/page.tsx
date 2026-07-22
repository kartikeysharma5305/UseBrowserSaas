'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { StatsCard } from '@/components/dashboard/stats-card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Agent = {
  id: string;
  name: string;
  status: string;
};

type Run = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  result?: string | null;
  duration?: number | null;
  agent?: {
    id?: string;
    name?: string;
  } | null;
};

export default function DashboardOverviewPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [agentsResponse, runsResponse] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/runs'),
        ]);

        if (!agentsResponse.ok || !runsResponse.ok) {
          throw new Error('Unable to load dashboard data.');
        }

        const [agentsPayload, runsPayload] = await Promise.all([
          agentsResponse.json(),
          runsResponse.json(),
        ]);

        setAgents(Array.isArray(agentsPayload?.data) ? agentsPayload.data : []);
        setRuns(Array.isArray(runsPayload?.data) ? runsPayload.data : []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load dashboard data.'
        );
      } finally {
        setLoading(false);
      }
    }

    void loadDashboardData();
  }, []);

  const stats = useMemo(() => {
    const totalAgents = agents.length;
    const activeAgents = agents.filter(
      (agent) => agent.status === 'ACTIVE'
    ).length;
    const totalRuns = runs.length;
    const successfulRuns = runs.filter(
      (run) => run.status === 'SUCCESS'
    ).length;

    return {
      totalAgents,
      activeAgents,
      totalRuns,
      successfulRuns,
      successRate: totalRuns
        ? Math.round((successfulRuns / totalRuns) * 100)
        : 0,
    };
  }, [agents, runs]);

  if (loading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">Welcome back</p>
        <h1 className="text-3xl font-semibold text-slate-900">
          Your Automation Overview
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Total Agents" value={String(stats.totalAgents)} />
        <StatsCard label="Active Agents" value={String(stats.activeAgents)} />
        <StatsCard label="Total Runs" value={String(stats.totalRuns)} />
        <StatsCard
          label="Successful Runs"
          value={`${stats.successRate}%`}
          detail={`${stats.successfulRuns}/${stats.totalRuns}`}
        />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Recent activity
            </h2>
            <p className="text-sm text-slate-500">
              Latest execution activity from your agents.
            </p>
          </div>
          <Button variant="secondary">View all runs</Button>
        </div>

        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Run your first agent to start tracking execution history."
          />
        ) : (
          <div className="space-y-3">
            {runs.slice(0, 6).map((run) => (
              <div
                key={run.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {run.agent?.name ?? 'Unknown agent'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {new Date(run.startedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <span className="text-sm text-slate-600">
                    {run.result ?? 'Run completed'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
