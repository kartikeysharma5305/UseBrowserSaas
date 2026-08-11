'use client';

import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import type {
  CurrentUsageResponse,
  UsageHistoryResponse,
} from '@/lib/usage/types';

function boundedPercent(value: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  return Number((value * 10_000n) / limit) / 100;
}

function formatBytes(value: string): string {
  const bytes = BigInt(value);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  let divisor = 1n;
  while (unit < units.length - 1 && bytes >= divisor * 1024n) {
    divisor *= 1024n;
    unit += 1;
  }
  const whole = bytes / divisor;
  const decimal = ((bytes % divisor) * 10n) / divisor;
  return `${whole}.${decimal} ${units[unit]}`;
}

function formatDuration(milliseconds: bigint): string {
  const minutes = milliseconds / 60_000n;
  const seconds = (milliseconds % 60_000n) / 1_000n;
  return minutes > 0n ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function UsageBar({
  label,
  value,
  limit,
  display,
}: {
  label: string;
  value: bigint;
  limit: bigint;
  display: string;
}) {
  const percent = Math.min(100, Math.max(0, boundedPercent(value, limit)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{display}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
      >
        <div
          className="h-full bg-emerald-600 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function UsageDashboard() {
  const [current, setCurrent] = useState<CurrentUsageResponse | null>(null);
  const [history, setHistory] = useState<UsageHistoryResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/usage/current').then((response) => {
        if (!response.ok) throw new Error('Unable to load current usage.');
        return response.json() as Promise<{ data: CurrentUsageResponse }>;
      }),
      fetch('/api/usage/history').then((response) => {
        if (!response.ok) throw new Error('Unable to load usage history.');
        return response.json() as Promise<{ data: UsageHistoryResponse[] }>;
      }),
    ])
      .then(([currentResponse, historyResponse]) => {
        if (!active) return;
        setCurrent(currentResponse.data);
        setHistory(historyResponse.data);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error ? failure.message : 'Unable to load usage.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <Card className="p-5 text-sm text-red-700 dark:text-red-300">
        {error}
      </Card>
    );
  }
  if (!current) {
    return (
      <div className="h-40 animate-pulse bg-slate-100 dark:bg-slate-800" />
    );
  }

  const runUsage = BigInt(current.usage.runs);
  const runLimit = BigInt(current.plan.limits.runsPerMonth);
  const storageUsage = BigInt(current.usage.artifactBytes);
  const storageLimit = BigInt(current.plan.limits.artifactStorageBytes);
  const executionUsage = BigInt(current.usage.executionMs);
  const executionLimit = BigInt(current.plan.limits.executionMsPerMonth);
  const approachingLimit =
    boundedPercent(runUsage, runLimit) >= 80 ||
    boundedPercent(executionUsage, executionLimit) >= 80 ||
    boundedPercent(storageUsage, storageLimit) >= 80;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Current plan
          </p>
          <p className="mt-2 text-2xl font-semibold">{current.plan.name}</p>
          <p className="mt-1 text-sm text-slate-500">
            Assigned manually during development
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Active runs
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {current.plan.limits.activeRuns}
          </p>
          <p className="mt-1 text-sm text-slate-500">Maximum at one time</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Artifact retention
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {current.plan.limits.retentionDays} days
          </p>
          <p className="mt-1 text-sm text-slate-500">Plus downgrade grace</p>
        </Card>
      </div>

      <section className="border-y border-slate-200 py-6 dark:border-slate-800">
        <h2 className="text-lg font-semibold">Current period</h2>
        <p className="mb-5 mt-1 text-sm text-slate-500">
          {new Date(current.period.start).toLocaleDateString()} to{' '}
          {new Date(current.period.end).toLocaleDateString()}
        </p>
        {approachingLimit ? (
          <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Usage is approaching a current-period limit. Review remaining Runs,
            execution time, and retained storage before starting expensive work.
          </p>
        ) : null}
        <div className="grid gap-6 md:grid-cols-3">
          <UsageBar
            label="Runs"
            value={runUsage}
            limit={runLimit}
            display={`${runUsage} / ${runLimit}`}
          />
          <UsageBar
            label="Execution time"
            value={executionUsage}
            limit={executionLimit}
            display={`${formatDuration(executionUsage)} / ${formatDuration(executionLimit)}`}
          />
          <UsageBar
            label="Retained storage"
            value={storageUsage}
            limit={storageLimit}
            display={`${formatBytes(current.usage.artifactBytes)} / ${formatBytes(current.plan.limits.artifactStorageBytes)}`}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Per Run maximums</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-500">Maximum duration</dt>
            <dd className="font-medium">
              {current.plan.limits.maxRunDurationMs / 1000} seconds
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Maximum steps</dt>
            <dd className="font-medium">
              {current.plan.limits.maxStepsPerRun}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Artifact bytes</dt>
            <dd className="font-medium">
              {formatBytes(String(current.plan.limits.maxArtifactBytesPerRun))}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Screenshots</dt>
            <dd className="font-medium">
              {current.plan.limits.maxArtifactsPerRun}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-slate-500">
          A Run may execute for up to{' '}
          {formatDuration(BigInt(current.plan.limits.maxRunDurationMs))} and{' '}
          {current.plan.limits.maxStepsPerRun} steps. These are resource limits,
          not monetary estimates.
        </p>
      </section>

      {current.usage.totalTokens !== null ? (
        <section>
          <h2 className="text-lg font-semibold">Provider-reported tokens</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">Input</dt>
              <dd className="font-medium">{current.usage.inputTokens}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Output</dt>
              <dd className="font-medium">{current.usage.outputTokens}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Total</dt>
              <dd className="font-medium">{current.usage.totalTokens}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Recent months</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
              <tr>
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 font-medium">Runs</th>
                <th className="py-2 font-medium">Attempts</th>
                <th className="py-2 font-medium">Execution</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr
                  key={item.period.start}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="py-3">
                    {new Date(item.period.start).toLocaleDateString(undefined, {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-3">{item.usage.runs}</td>
                  <td className="py-3">{item.usage.attempts}</td>
                  <td className="py-3">
                    {Math.round(Number(item.usage.executionMs) / 1000)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {current.usage.totalTokens === null ? (
          <p className="mt-3 text-xs text-slate-500">
            Token metrics remain unavailable until the provider reports exact
            counts.
          </p>
        ) : null}
      </section>
    </div>
  );
}
