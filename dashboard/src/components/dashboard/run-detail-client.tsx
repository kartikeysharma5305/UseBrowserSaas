'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  CircleStop,
  ExternalLink,
  ImageIcon,
  Radio,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorState } from '@/components/dashboard/error-state';
import { ResultMarkdown } from '@/components/dashboard/result-markdown';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type {
  RunArtifactRecord,
  RunRecord,
  RunResponse,
  RunStreamAgentEvent,
  RunStreamArtifact,
  RunStreamConnectionState,
  RunStreamSnapshot,
  RunStreamStatus,
} from '@/lib/types';
import { buildTimeline, timelineTone } from '@/lib/observability/timeline';
import {
  currentRunActivity,
  describeMeaningfulStep,
  failurePresentation,
  formatElapsed,
  meaningfulTimelineEvents,
} from '@/lib/observability/presentation';
import { formatDate } from '@/lib/utils/format-date';
import {
  formatRunResultDetails,
  getRunSummary,
  getVisitedUrls,
  isBrowserRunResult,
  isHttpUrl,
} from '@/lib/utils/format-run-result';

const timelineStyles = {
  started: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30',
  completed:
    'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/25',
  failed:
    'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30',
  system: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
};

function Screenshot({
  artifact,
  onOpen,
}: {
  artifact: RunArtifactRecord;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left dark:border-slate-800 dark:bg-slate-950"
      aria-label={`Open screenshot${artifact.stepNumber ? ` for step ${artifact.stepNumber}` : ''}`}
    >
      {broken ? (
        <span className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
          <ImageIcon className="h-4 w-4" />
          Image unavailable
        </span>
      ) : (
        <Image
          src={artifact.url}
          alt={`Browser screenshot${artifact.stepNumber ? ` from step ${artifact.stepNumber}` : ''}`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform group-hover:scale-[1.02]"
          onError={() => setBroken(true)}
        />
      )}
    </button>
  );
}

export function RunDetailClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<number | null>(null);
  const [connectionState, setConnectionState] =
    useState<RunStreamConnectionState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    try {
      const response = await fetch(`/api/runs/${runId}`);
      if (!response.ok) throw new Error('Unable to load run details.');
      const payload: Partial<RunResponse> = await response.json();
      setRun(payload?.data ?? null);
      setError(null);
      setLastUpdatedAt(new Date());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load run details.'
      );
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  useEffect(() => {
    const active = run?.status === 'QUEUED' || run?.status === 'RUNNING';
    if (!active) {
      if (run) setConnectionState('closed');
      return;
    }

    const lastSequence = Math.max(
      0,
      ...(run.events ?? []).map((event) => event.sequence ?? 0)
    );
    const source = new EventSource(
      `/api/runs/${encodeURIComponent(runId)}/stream?afterSequence=${lastSequence}`
    );
    let fallbackStart: ReturnType<typeof setTimeout> | undefined;
    let fallbackPoll: ReturnType<typeof setInterval> | undefined;
    const stopFallback = () => {
      if (fallbackStart) clearTimeout(fallbackStart);
      if (fallbackPoll) clearInterval(fallbackPoll);
      fallbackStart = undefined;
      fallbackPoll = undefined;
    };
    const beginFallback = () => {
      if (fallbackStart || fallbackPoll) return;
      fallbackStart = setTimeout(() => {
        setConnectionState('polling');
        void loadRun();
        fallbackPoll = setInterval(() => void loadRun(), 4_000);
      }, 5_000);
    };
    const markUpdated = () => setLastUpdatedAt(new Date());

    setConnectionState('connecting');
    source.onopen = () => {
      stopFallback();
      setConnectionState('live');
      markUpdated();
    };
    source.onerror = () => {
      setConnectionState('reconnecting');
      beginFallback();
    };
    source.addEventListener('snapshot', (message) => {
      const payload = JSON.parse(message.data) as RunStreamSnapshot;
      setRun((current) => ({
        ...payload.run,
        events: current?.events ?? payload.run.events,
        artifacts: current?.artifacts ?? payload.run.artifacts,
      }));
      setLoading(false);
      markUpdated();
    });
    source.addEventListener('agent-event', (message) => {
      const payload = JSON.parse(message.data) as RunStreamAgentEvent;
      setRun((current) => {
        if (!current) return current;
        const events = current.events ?? [];
        if (
          events.some(
            (event) =>
              event.id === payload.event.id ||
              (event.sequence !== undefined &&
                event.sequence === payload.event.sequence)
          )
        ) {
          return current;
        }
        return {
          ...current,
          events: [...events, payload.event].sort(
            (left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)
          ),
        };
      });
      markUpdated();
    });
    source.addEventListener('run-artifact', (message) => {
      const payload = JSON.parse(message.data) as RunStreamArtifact;
      setRun((current) => {
        if (!current) return current;
        const artifacts = current.artifacts ?? [];
        if (artifacts.some((artifact) => artifact.id === payload.artifact.id)) {
          return current;
        }
        return { ...current, artifacts: [...artifacts, payload.artifact] };
      });
      markUpdated();
    });
    source.addEventListener('run-status', (message) => {
      const payload = JSON.parse(message.data) as RunStreamStatus;
      setRun((current) =>
        current
          ? {
              ...current,
              status: payload.status,
              startedAt: payload.startedAt,
              completedAt: payload.completedAt,
              duration: payload.duration,
              attemptDuration: payload.attemptDuration,
              result: payload.result,
              errorMessage: payload.errorMessage,
              cancelRequestedAt: payload.cancelRequestedAt,
              canceledAt: payload.canceledAt,
              cancelReason: payload.cancelReason,
            }
          : current
      );
      markUpdated();
    });
    source.addEventListener('heartbeat', markUpdated);
    source.addEventListener('stream-end', () => {
      stopFallback();
      source.close();
      setConnectionState('closed');
      void loadRun();
    });

    return () => {
      stopFallback();
      source.close();
    };
  }, [loadRun, run?.status, runId]);

  async function requestCancellation() {
    setCanceling(true);
    setCancelError(null);
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const payload = (await response.json()) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to cancel this run.');
      }
      setCancelDialogOpen(false);
      await loadRun();
    } catch (cancelFailure) {
      setCancelError(
        cancelFailure instanceof Error
          ? cancelFailure.message
          : 'Unable to cancel this run.'
      );
    } finally {
      setCanceling(false);
    }
  }

  const events = useMemo(
    () => (Array.isArray(run?.events) ? run.events : []),
    [run?.events]
  );
  const artifacts = useMemo(
    () => (Array.isArray(run?.artifacts) ? run.artifacts : []),
    [run?.artifacts]
  );
  const timeline = useMemo(
    () => buildTimeline(events, artifacts),
    [events, artifacts]
  );
  const meaningfulSteps = useMemo(
    () => meaningfulTimelineEvents(timeline),
    [timeline]
  );

  if (loading) {
    return (
      <div className="h-80 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
    );
  }
  if (error || !run) {
    return <ErrorState message={error ?? 'Run not found.'} />;
  }

  const browserResult = isBrowserRunResult(run.result);
  const summary = getRunSummary(run.result);
  const visitedUrls = getVisitedUrls(run.result);
  const numberedStepCount = new Set(
    meaningfulSteps
      .map((event) => event.structuredData.stepNumber)
      .filter((step): step is number => typeof step === 'number')
  ).size;
  const stepCount = numberedStepCount || meaningfulSteps.length;
  const selected =
    selectedArtifact === null ? null : (artifacts[selectedArtifact] ?? null);
  const active = run.status === 'QUEUED' || run.status === 'RUNNING';
  const cancellationPending = Boolean(run.cancelRequestedAt);
  const currentActivity = currentRunActivity(timeline);
  const failure = run.errorMessage
    ? failurePresentation(run.errorMessage, run.status)
    : null;

  function moveScreenshot(offset: number) {
    if (selectedArtifact === null || artifacts.length === 0) return;
    setSelectedArtifact(
      (selectedArtifact + offset + artifacts.length) % artifacts.length
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-500">
            <span>Run detail</span>
            <span className="inline-flex items-center gap-1">
              <Radio className="h-3.5 w-3.5" />
              {connectionState === 'live'
                ? 'Live'
                : connectionState === 'reconnecting'
                  ? 'Reconnecting'
                  : connectionState === 'polling'
                    ? 'Polling'
                    : connectionState === 'connecting'
                      ? 'Connecting'
                      : 'Complete'}
            </span>
            {lastUpdatedAt && (
              <span>Updated {lastUpdatedAt.toLocaleTimeString()}</span>
            )}
          </div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {run.agent?.name ?? 'Unknown agent'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Started {formatDate(run.startedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {active && (
            <Button
              variant="secondary"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancellationPending || canceling}
            >
              <CircleStop className="mr-2 h-4 w-4" />
              {cancellationPending ? 'Canceling' : 'Cancel run'}
            </Button>
          )}
          <Link
            href="/dashboard/runs"
            className="inline-flex items-center rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium dark:border-slate-700"
          >
            Back to runs
          </Link>
          {run.agent?.id && (
            <Link
              href={`/dashboard/agents/${run.agent.id}`}
              className="inline-flex items-center rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium dark:border-slate-700"
            >
              View agent
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Status</p>
          <div className="mt-2">
            <StatusBadge status={run.status} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">
            {(run.attempt ?? 1) > 1 ? 'Total run duration' : 'Duration'}
          </p>
          <p className="mt-2 text-xl font-semibold">
            {formatElapsed(run.duration)}
          </p>
          {(run.attempt ?? 1) > 1 && run.attemptDuration != null && (
            <p className="mt-1 text-xs text-slate-500">
              Final attempt: {formatElapsed(run.attemptDuration)}
            </p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Steps</p>
          <p className="mt-2 text-xl font-semibold">{stepCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Model</p>
          <p className="mt-2 break-words text-sm font-medium">
            {run.model ?? '—'}
          </p>
        </Card>
      </div>

      {active && (
        <Card className="border-sky-200 bg-sky-50/70 p-5 dark:border-sky-900 dark:bg-sky-950/30">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">
                {run.status === 'QUEUED'
                  ? 'Waiting to start'
                  : 'Run in progress'}
              </p>
              <p className="mt-1 text-lg font-medium">{currentActivity}</p>
            </div>
            <p className="text-sm text-sky-800 dark:text-sky-200">
              {stepCount} {stepCount === 1 ? 'step' : 'steps'} completed
            </p>
          </div>
        </Card>
      )}

      {run.inputSnapshot ? (
        <Card className="p-5">
          <h2 className="text-lg font-semibold">Run input snapshot</h2>
          <p className="mt-1 text-sm text-slate-500">
            Immutable values captured when this Run was admitted.
          </p>
          {run.inputSnapshot.values.length ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {run.inputSnapshot.values.map((input) => (
                <div
                  key={input.key}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {input.label}
                  </dt>
                  <dd className="mt-1 break-words text-sm">
                    {input.redacted || input.type === 'SECRET'
                      ? '••••••••'
                      : String(input.value)}
                  </dd>
                  <p className="mt-1 text-xs text-slate-500">
                    {input.source === 'default' ? 'Defaulted' : 'Supplied'}
                  </p>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              This Run used no variable values.
            </p>
          )}
        </Card>
      ) : null}

      {failure && (
        <div className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <p className="font-semibold">{failure.title}</p>
          <p className="mt-1">{failure.description}</p>
        </div>
      )}
      {run.status === 'CANCELED' && (
        <div className="border-l-4 border-slate-400 bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-semibold">Run canceled</p>
          {run.cancelReason && <p className="mt-1">{run.cancelReason}</p>}
        </div>
      )}
      {cancelError && (
        <div
          role="alert"
          className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {cancelError}
        </div>
      )}

      <section
        aria-labelledby="final-result-heading"
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Result
        </p>
        <h2 id="final-result-heading" className="mt-1 text-xl font-semibold">
          Final result
        </h2>
        <div className="mt-5 min-w-0">
          {browserResult ? (
            <ResultMarkdown content={summary} />
          ) : typeof run.result === 'string' ? (
            <ResultMarkdown content={run.result} />
          ) : (
            <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-950">
              {formatRunResultDetails(run.result)}
            </pre>
          )}
        </div>
      </section>

      {run.structuredStatus && run.structuredStatus !== 'NOT_REQUESTED' && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Structured result</h2>
              <p className="text-sm text-slate-500">
                Schema version {run.outputSchemaVersion ?? '—'} · Validation{' '}
                {run.structuredStatus.replaceAll('_', ' ').toLowerCase()}
              </p>
            </div>
            {['VALID', 'PARTIAL'].includes(run.structuredStatus) && (
              <div className="flex gap-2">
                <a
                  className="rounded border px-3 py-2 text-sm"
                  href={`/api/runs/${run.id}/result.json`}
                >
                  Download JSON
                </a>
                <a
                  className="rounded border px-3 py-2 text-sm"
                  href={`/api/runs/${run.id}/result.csv`}
                >
                  Download CSV
                </a>
              </div>
            )}
          </div>
          {run.structuredStatus === 'PARTIAL' && (
            <p className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Partial result: only fields that passed validation are shown.
            </p>
          )}
          {run.structuredResult &&
          typeof run.structuredResult === 'object' &&
          !Array.isArray(run.structuredResult) ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {Object.entries(run.structuredResult)
                .slice(0, 50)
                .map(([key, value]) => (
                  <div key={key} className="min-w-0 rounded border p-3">
                    <dt className="text-xs font-semibold uppercase text-slate-500">
                      {key}
                    </dt>
                    <dd className="mt-1 max-h-40 overflow-auto break-words text-sm">
                      {typeof value === 'object'
                        ? JSON.stringify(value, null, 2)
                        : String(value)}
                    </dd>
                  </div>
                ))}
            </dl>
          ) : run.structuredResult ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
              {JSON.stringify(run.structuredResult, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              No validated fields are available.
            </p>
          )}
          {Array.isArray(run.structuredErrors) &&
            run.structuredErrors.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Validation errors</h3>
                <ul className="mt-2 space-y-1 text-sm text-rose-700 dark:text-rose-300">
                  {run.structuredErrors.slice(0, 100).map((error, index) => (
                    <li key={index}>
                      {error &&
                      typeof error === 'object' &&
                      !Array.isArray(error)
                        ? `${String(error.path ?? '$')}: ${String(error.message ?? 'Invalid value.')}`
                        : 'Invalid value.'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Raw-result handling</summary>
            <p className="mt-2">
              The bounded raw candidate is retained for diagnostics but is not
              returned by this API because it may contain unvalidated sensitive
              text.
            </p>
          </details>
        </Card>
      )}

      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Run steps</h2>
            <p className="text-sm text-slate-500">
              Meaningful actions completed by the Agent.
            </p>
          </div>
          <span className="text-sm text-slate-500">
            {meaningfulSteps.length}{' '}
            {meaningfulSteps.length === 1 ? 'step' : 'steps'}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {meaningfulSteps.length === 0 ? (
            <p className="text-sm text-slate-500">
              {active ? currentActivity : 'No completed steps were recorded.'}
            </p>
          ) : (
            meaningfulSteps.map((event, index) => {
              const tone = timelineTone(
                event.type,
                event.structuredData.success
              );
              return (
                <article
                  key={event.id}
                  className={`border-l-4 p-4 ${timelineStyles[tone]}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">
                      <span>
                        Step {event.structuredData.stepNumber ?? index + 1}
                      </span>
                    </div>
                    <time className="text-xs text-slate-500">
                      {formatDate(event.timestamp)}
                    </time>
                  </div>
                  <p className="mt-2 text-sm font-medium">
                    {describeMeaningfulStep(event)}
                  </p>
                  {event.structuredData.url && (
                    <a
                      href={event.structuredData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 break-all text-sm text-sky-700 underline dark:text-sky-400"
                    >
                      {event.structuredData.url}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  )}
                  {event.artifacts.length > 0 && (
                    <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2">
                      {event.artifacts.map((artifact) => (
                        <Screenshot
                          key={artifact.id}
                          artifact={artifact}
                          onOpen={() =>
                            setSelectedArtifact(
                              artifacts.findIndex(
                                (item) => item.id === artifact.id
                              )
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <summary className="cursor-pointer text-sm font-semibold">
          Technical details ({timeline.length} events)
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          Detailed execution events are retained for troubleshooting.
        </p>
        <ol className="mt-3 max-h-96 space-y-2 overflow-auto text-xs">
          {timeline.map((event) => (
            <li
              key={event.id}
              className="border-l-2 border-slate-200 pl-3 dark:border-slate-700"
            >
              <span className="font-semibold">
                #{event.displaySequence} · {event.type.replaceAll('_', ' ')}
              </span>
              <span className="ml-2 text-slate-500">{event.message}</span>
              {event.structuredData.durationMs !== undefined && (
                <span className="ml-2 text-slate-500">
                  {formatElapsed(event.structuredData.durationMs)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </details>

      <section>
        <h2 className="text-lg font-semibold">Screenshots</h2>
        {artifacts.length === 0 ? (
          <div className="mt-3 flex min-h-32 items-center justify-center border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700">
            No screenshots were captured.
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {artifacts.map((artifact, index) => (
              <div key={artifact.id}>
                <Screenshot
                  artifact={artifact}
                  onOpen={() => setSelectedArtifact(index)}
                />
                <p className="mt-2 text-xs text-slate-500">
                  {artifact.stepNumber
                    ? `Step ${artifact.stepNumber}`
                    : 'Unassigned step'}
                  {' · '}
                  {formatDate(artifact.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {visitedUrls.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Visited URLs</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {visitedUrls.map((url, index) => (
              <li key={`${url}-${index}`} className="break-all">
                {isHttpUrl(url) ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {url}
                  </a>
                ) : (
                  url
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot viewer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedArtifact(null)}
        >
          <div
            className="relative h-[min(80vh,800px)] w-full max-w-6xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={selected.url}
              alt={`Full screenshot${selected.stepNumber ? ` from step ${selected.stepNumber}` : ''}`}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
            />
            <Button
              variant="secondary"
              className="absolute right-2 top-2 h-10 w-10 p-0"
              onClick={() => setSelectedArtifact(null)}
              title="Close screenshot"
            >
              <X className="h-5 w-5" />
            </Button>
            {artifacts.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  className="absolute left-2 top-1/2 h-10 w-10 -translate-y-1/2 p-0"
                  onClick={() => moveScreenshot(-1)}
                  title="Previous screenshot"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="secondary"
                  className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 p-0"
                  onClick={() => moveScreenshot(1)}
                  title="Next screenshot"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {cancelDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !canceling && setCancelDialogOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-run-title"
            aria-describedby="cancel-run-description"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="cancel-run-title" className="text-lg font-semibold">
              Cancel this run?
            </h2>
            <p
              id="cancel-run-description"
              className="mt-2 text-sm text-slate-600 dark:text-slate-300"
            >
              The worker will stop the active agent and close its browser
              session.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setCancelDialogOpen(false)}
                disabled={canceling}
              >
                Keep running
              </Button>
              <Button
                onClick={() => void requestCancellation()}
                disabled={canceling}
                autoFocus
              >
                <CircleStop className="mr-2 h-4 w-4" />
                {canceling ? 'Canceling' : 'Cancel run'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
