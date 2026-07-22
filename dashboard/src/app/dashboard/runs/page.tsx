'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { RunTable } from '@/components/dashboard/run-table';
import { Button } from '@/components/ui/button';

type Run = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  duration?: number | null;
  result?: string | null;
  agent?: { name?: string } | null;
};

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRuns() {
      try {
        const response = await fetch('/api/runs');

        if (!response.ok) {
          throw new Error('Unable to load runs.');
        }

        const payload = await response.json();
        setRuns(Array.isArray(payload?.data) ? payload.data : []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load runs.'
        );
      } finally {
        setLoading(false);
      }
    }

    void loadRuns();
  }, []);

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      const matchesQuery =
        query.trim().length === 0 ||
        (run.agent?.name ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (run.result ?? '').toLowerCase().includes(query.toLowerCase());

      const matchesStatus =
        statusFilter === 'ALL' || run.status.toUpperCase() === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [query, runs, statusFilter]);

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
          <p className="text-sm font-medium text-slate-500">
            Execution history
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">Runs</h1>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by agent or result"
            className="rounded-lg border px-3 py-2"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border px-3 py-2"
          >
            <option value="ALL">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="RUNNING">Running</option>
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
