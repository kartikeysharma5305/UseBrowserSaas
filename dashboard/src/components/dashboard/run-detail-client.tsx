'use client';

import { useEffect, useState } from 'react';

import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { Card } from '@/components/ui/card';

type Event = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
};

type Run = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  duration?: number | null;
  result?: string | null;
  errorMessage?: string | null;
  agent?: {
    id?: string;
    name?: string;
  } | null;
  events?: Event[];
};

export function RunDetailClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRun() {
    try {
      const response = await fetch(`/api/runs/${runId}`);

      if (!response.ok) {
        throw new Error('Unable to load run details.');
      }

      const payload = await response.json();
      setRun(payload?.data ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load run details.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRun();
  }, [runId]);

  if (loading) {
    return <LoadingSkeleton lines={8} />;
  }

  if (error || !run) {
    return <ErrorState message={error ?? 'Run not found.'} />;
  }

  const events = Array.isArray(run.events) ? run.events : [];
  const runResult =
    typeof run.result === 'object' && run.result !== null
      ? (run.result as Record<string, unknown>)
      : null;
  const visitedUrls = Array.isArray(runResult?.visitedUrls)
    ? (runResult.visitedUrls as string[])
    : [];
  const summary =
    typeof runResult?.summary === 'string' ? runResult.summary : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Run detail</p>
          <h1 className="text-3xl font-semibold text-slate-900">
            {run.agent?.name ?? 'Unknown agent'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Started {new Date(run.startedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/dashboard/runs"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to runs
          </a>
          {run.agent?.id && (
            <a
              href={`/dashboard/agents/${run.agent.id}`}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View agent
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Status</p>
          <div className="mt-2">
            <StatusBadge status={run.status} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Duration</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {run.duration ?? '—'} ms
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Completed</p>
          <p className="mt-2 text-sm text-slate-900">
            {run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}
          </p>
        </Card>
      </div>

      {run.errorMessage && (
        <Card className="border-red-200 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="mt-1 text-sm text-red-700">{run.errorMessage}</p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900">Result</h2>
        <div className="mt-3 rounded-lg bg-slate-50 p-4">
          {summary ? (
            <p className="whitespace-pre-wrap text-sm text-slate-900">
              {summary}
            </p>
          ) : (
            <p className="text-sm text-slate-500">No result captured.</p>
          )}
        </div>
        {visitedUrls.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700">Visited URLs</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {visitedUrls.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900">Timeline</h2>
        <div className="mt-4 space-y-3">
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">No events recorded.</p>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-1 rounded-lg border border-slate-200 px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    {event.type.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-sm text-slate-900">{event.message}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
