'use client';

import { useMemo, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { RunTable } from '@/components/dashboard/run-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { RunRecord, RunsResponse } from '@/lib/types';
import { getRunResultSearchText } from '@/lib/utils/format-run-result';

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadRuns() {
    try {
      const response = await fetch('/api/runs');

      if (!response.ok) {
        throw new Error('Unable to load runs.');
      }

      const payload: Partial<RunsResponse> = await response.json();
      const data = Array.isArray(payload?.data) ? payload.data : [];
      setRuns(data);

      const hasRunning = data.some(
        (run) => run.status === 'QUEUED' || run.status === 'RUNNING'
      );

      if (hasRunning) {
        setError(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Unable to load runs.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    const hasRunning = runs.some(
      (run) => run.status === 'QUEUED' || run.status === 'RUNNING'
    );

    if (!hasRunning) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(() => {
      void loadRuns();
    }, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return runs.filter((run) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        (run.agent?.name ?? '').toLowerCase().includes(normalizedQuery) ||
        getRunResultSearchText(run.result)
          .toLowerCase()
          .includes(normalizedQuery);

      const matchesStatus =
        statusFilter === 'ALL' || run.status.toUpperCase() === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [query, runs, statusFilter]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-slate-50 dark:bg-slate-700" />
        <Card className="overflow-hidden">
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-slate-50 dark:bg-slate-700"
              />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Execution history
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            Runs
          </h1>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by agent or result"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-600"
          >
            <option value="ALL">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="RUNNING">Running</option>
            <option value="TIMED_OUT">Timed out</option>
          </select>
        </div>
      </div>

      {filteredRuns.length === 0 ? (
        <EmptyState
          title="No matching runs"
          description="Try adjusting your search or run an agent to create the first execution record."
          action={<Button variant="secondary">Refresh</Button>}
        />
      ) : (
        <RunTable runs={filteredRuns} />
      )}
    </div>
  );
}
