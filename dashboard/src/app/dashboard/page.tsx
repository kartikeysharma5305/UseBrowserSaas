'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { StatsCard } from '@/components/dashboard/stats-card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { Card } from '@/components/ui/card';
import type { RunRecord, RunsResponse } from '@/lib/types';
import { formatDate } from '@/lib/utils/format-date';
import { formatRunResult } from '@/lib/utils/format-run-result';
import { OnboardingCard } from '@/components/dashboard/onboarding-card';

type Agent = {
  id: string;
  name: string;
  status: string;
};

export default function DashboardOverviewPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
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

        const [agentsPayload, runsPayload]: [
          { data?: Agent[] },
          Partial<RunsResponse>,
        ] = await Promise.all([agentsResponse.json(), runsResponse.json()]);

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
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5">
              <div className="animate-pulse space-y-3">
                <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-8 w-16 rounded-lg bg-slate-50 dark:bg-slate-700" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Welcome back
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Your Automation Overview
        </h1>
      </div>

      <OnboardingCard />

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

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Recent activity
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Latest execution activity from your agents.
            </p>
          </div>
          <Link
            href="/dashboard/runs"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            View all runs
          </Link>
        </div>

        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Run your first agent to start tracking execution history."
          />
        ) : (
          <div className="space-y-3">
            {runs.slice(0, 6).map((run) => (
              <Link
                key={run.id}
                href={`/dashboard/runs/${run.id}`}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between dark:border-slate-800"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {run.agent?.name ?? 'Unknown agent'}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {formatDate(run.startedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {formatRunResult(run.result)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
