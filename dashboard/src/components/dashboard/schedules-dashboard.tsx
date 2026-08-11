'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { ScheduleForm } from '@/components/dashboard/schedule-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type {
  ScheduleAgentOption,
  ScheduleOccurrenceView,
  ScheduleView,
  SchedulingPlanView,
} from '@/lib/scheduling/client-types';
import {
  occurrenceMessage,
  recurrenceSummary,
  safeScheduleError,
} from '@/lib/scheduling/presentation';
import { formatDate } from '@/lib/utils/format-date';

type Editing = ScheduleView | 'new' | null;

function occurrenceTone(status: string) {
  if (status === 'ADMITTED') return 'success' as const;
  if (status === 'FAILED' || status.endsWith('_BLOCKED'))
    return 'danger' as const;
  if (status === 'MISSED' || status === 'SKIPPED') return 'warning' as const;
  return 'default' as const;
}

function scheduleLabel(schedule: ScheduleView) {
  if (schedule.state === 'COMPLETED') return 'COMPLETED';
  return schedule.state === 'ENABLED' ? 'ACTIVE' : 'PAUSED';
}

export function SchedulesDashboard({
  agentId,
  compact = false,
}: {
  agentId?: string;
  compact?: boolean;
}) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [agents, setAgents] = useState<ScheduleAgentOption[]>([]);
  const [plan, setPlan] = useState<SchedulingPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    runId?: string;
  } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<ScheduleOccurrenceView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const requestSequence = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const [scheduleResponse, agentResponse, usageResponse] =
        await Promise.all([
          fetch('/api/schedules', { signal: controller.signal }),
          fetch('/api/agents', { signal: controller.signal }),
          fetch('/api/usage/current', { signal: controller.signal }),
        ]);
      if (!scheduleResponse.ok || !agentResponse.ok || !usageResponse.ok)
        throw new Error('Unable to load schedules. Please try again.');
      const [schedulePayload, agentPayload, usagePayload] = await Promise.all([
        scheduleResponse.json(),
        agentResponse.json(),
        usageResponse.json(),
      ]);
      if (sequence !== requestSequence.current || controller.signal.aborted)
        return;
      const allSchedules = Array.isArray(schedulePayload?.data)
        ? (schedulePayload.data as ScheduleView[])
        : [];
      setSchedules(
        agentId
          ? allSchedules.filter((schedule) => schedule.agentId === agentId)
          : allSchedules
      );
      setAgents(
        Array.isArray(agentPayload?.data)
          ? agentPayload.data.map((agent: ScheduleAgentOption) => ({
              id: agent.id,
              name: agent.name,
              variables: agent.variables ?? [],
            }))
          : []
      );
      setPlan(usagePayload?.data?.plan ?? null);
      setError(null);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to load schedules. Please try again.'
      );
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
    return () => {
      loadController.current?.abort();
      historyController.current?.abort();
    };
  }, [load]);

  async function loadHistory(scheduleId: string, append = false) {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setHistoryLoading(true);
    const current = append && historyId === scheduleId ? history : [];
    const cursor = append ? current.at(-1)?.id : undefined;
    try {
      const query = new URLSearchParams({ limit: '10' });
      if (cursor) query.set('cursor', cursor);
      const response = await fetch(
        `/api/schedules/${scheduleId}/occurrences?${query}`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error('Unable to load occurrence history.');
      const payload = await response.json();
      const next = Array.isArray(payload?.data)
        ? (payload.data as ScheduleOccurrenceView[])
        : [];
      if (controller.signal.aborted) return;
      setHistoryId(scheduleId);
      setHistory(append ? [...current, ...next] : next);
      setHistoryHasMore(next.length === 10);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to load occurrence history.'
        );
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  }

  async function action(
    schedule: ScheduleView,
    command: 'pause' | 'resume' | 'skip-next' | 'run-now' | 'delete'
  ) {
    const operation = `${schedule.id}:${command}`;
    if (busy) return;
    if (
      command === 'pause' &&
      !window.confirm('Pause future occurrences? Existing Runs will continue.')
    )
      return;
    if (
      command === 'skip-next' &&
      !window.confirm(
        `Skip the next occurrence${
          schedule.nextRunAt ? ` at ${formatDate(schedule.nextRunAt)}` : ''
        }? This is recorded in history.`
      )
    )
      return;
    if (
      command === 'delete' &&
      !window.confirm(
        'Delete this schedule and stop future triggers? Existing Runs are not canceled.'
      )
    )
      return;

    setBusy(operation);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/schedules/${schedule.id}${command === 'delete' ? '' : `/${command}`}`,
        { method: command === 'delete' ? 'DELETE' : 'POST' }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409)
          throw new Error(
            'This schedule changed elsewhere. Refresh and try again.'
          );
        throw new Error(
          safeScheduleError(payload, 'Unable to update schedule.')
        );
      }
      if (command === 'run-now') {
        setNotice({
          message:
            'Run admitted without changing the next scheduled occurrence.',
          runId: payload?.data?.runId,
        });
      } else {
        setNotice({
          message: `Schedule ${command.replace('-', ' ')} completed.`,
        });
      }
      if (command === 'delete' && historyId === schedule.id) {
        setHistoryId(null);
        setHistory([]);
      }
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update schedule.'
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div aria-label="Loading schedules" className="space-y-3">
        <div className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  const enabledCount = schedules.filter(
    (schedule) => schedule.state === 'ENABLED'
  ).length;
  const schedulingEnabled = Boolean(plan?.limits.schedulingEnabled);

  return (
    <div className="space-y-6">
      {!compact ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Automated execution
            </p>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
              Schedules
            </h1>
          </div>
          <Button
            onClick={() => setEditing('new')}
            disabled={
              !schedulingEnabled || agents.length === 0 || editing !== null
            }
          >
            Create schedule
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Schedules</h2>
            <p className="text-sm text-slate-500">
              Automated Runs for this Agent.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setEditing('new')}
            disabled={!schedulingEnabled || editing !== null}
          >
            Create schedule
          </Button>
        </div>
      )}

      {plan ? (
        <Card className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{plan.name} plan</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {schedulingEnabled
                  ? `${enabledCount} of ${plan.limits.maxActiveSchedules} active schedules used.`
                  : 'Scheduling is unavailable on FREE. Existing definitions remain visible but cannot trigger Runs.'}
              </p>
            </div>
            {!schedulingEnabled ? (
              <Link
                href="/dashboard/billing"
                className="text-sm font-medium text-slate-900 underline underline-offset-4 dark:text-white"
              >
                Upgrade to PRO
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice.message}{' '}
          {notice.runId ? (
            <Link
              href={`/dashboard/runs/${notice.runId}`}
              className="font-medium underline"
            >
              View Run
            </Link>
          ) : null}
        </Card>
      ) : null}

      {editing ? (
        <ScheduleForm
          agents={agents}
          schedule={editing === 'new' ? undefined : editing}
          defaultAgentId={agentId}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice({
              message:
                editing === 'new' ? 'Schedule created.' : 'Schedule updated.',
            });
            await load();
          }}
        />
      ) : null}

      {schedules.length === 0 ? (
        <EmptyState
          title={agentId ? 'No schedules for this Agent' : 'No schedules yet'}
          description={
            schedulingEnabled
              ? 'Create a one-time, daily or weekly schedule to automate an Agent.'
              : 'Upgrade to PRO to create schedules.'
          }
          action={
            schedulingEnabled && agents.length > 0 ? (
              <Button onClick={() => setEditing('new')}>Create schedule</Button>
            ) : (
              <Link
                href="/dashboard/billing"
                className="text-sm font-medium underline"
              >
                View plans
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          {schedules.map((schedule) => {
            const recent = schedule.occurrences?.[0];
            const itemBusy = busy !== null;
            return (
              <Card key={schedule.id} className="overflow-hidden">
                <div className="grid gap-4 p-5 lg:grid-cols-[1.3fr_1fr_1fr_auto] lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {schedule.agent?.name ??
                          agents.find((agent) => agent.id === schedule.agentId)
                            ?.name ??
                          'Agent'}
                      </p>
                      <Badge
                        tone={
                          schedule.state === 'ENABLED'
                            ? 'success'
                            : schedule.state === 'PAUSED'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {scheduleLabel(schedule)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                      {recurrenceSummary(schedule)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {schedule.timezone}
                    </p>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">
                        Next occurrence
                      </dt>
                      <dd>
                        {schedule.nextRunAt
                          ? formatDate(schedule.nextRunAt)
                          : 'None'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Last trigger</dt>
                      <dd>
                        {schedule.lastTriggeredOccurrenceAt
                          ? formatDate(schedule.lastTriggeredOccurrenceAt)
                          : 'Not triggered'}
                      </dd>
                    </div>
                  </dl>
                  <div className="text-sm">
                    <p className="text-xs text-slate-500">Recent outcome</p>
                    {recent ? (
                      <div className="mt-1 space-y-1">
                        <Badge tone={occurrenceTone(recent.status)}>
                          {recent.status}
                        </Badge>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {occurrenceMessage(recent.status)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-slate-500">No occurrences yet</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[18rem] lg:justify-end">
                    {schedule.state === 'ENABLED' ? (
                      <Button
                        variant="secondary"
                        disabled={itemBusy}
                        onClick={() => action(schedule, 'pause')}
                      >
                        Pause
                      </Button>
                    ) : schedule.state === 'PAUSED' ? (
                      <Button
                        variant="secondary"
                        disabled={itemBusy || !schedulingEnabled}
                        onClick={() => action(schedule, 'resume')}
                      >
                        Resume
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      disabled={itemBusy || schedule.state !== 'ENABLED'}
                      onClick={() => action(schedule, 'skip-next')}
                    >
                      Skip next
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={itemBusy}
                      onClick={() => action(schedule, 'run-now')}
                    >
                      Run now
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={itemBusy}
                      onClick={() => setEditing(schedule)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      disabled={itemBusy}
                      onClick={() => action(schedule, 'delete')}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={historyLoading && historyId === schedule.id}
                      onClick={() => {
                        if (historyId === schedule.id) {
                          setHistoryId(null);
                          setHistory([]);
                        } else {
                          void loadHistory(schedule.id);
                        }
                      }}
                    >
                      {historyId === schedule.id
                        ? 'Hide history'
                        : 'View history'}
                    </Button>
                  </div>
                </div>

                {historyId === schedule.id ? (
                  <div className="border-t border-slate-200 p-5 dark:border-slate-800">
                    <h3 className="font-semibold">Recent occurrences</h3>
                    {historyLoading && history.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">
                        Loading history…
                      </p>
                    ) : history.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">
                        No occurrence history.
                      </p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[42rem] text-left text-sm">
                          <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
                            <tr>
                              <th className="py-2 font-medium">Scheduled</th>
                              <th className="py-2 font-medium">Discovered</th>
                              <th className="py-2 font-medium">Outcome</th>
                              <th className="py-2 font-medium">Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((occurrence) => (
                              <tr
                                key={occurrence.id}
                                className="border-b border-slate-100 dark:border-slate-800"
                              >
                                <td className="py-3">
                                  {formatDate(occurrence.scheduledFor)}
                                </td>
                                <td className="py-3">
                                  {occurrence.discoveredAt
                                    ? formatDate(occurrence.discoveredAt)
                                    : '—'}
                                </td>
                                <td className="py-3">
                                  <Badge
                                    tone={occurrenceTone(occurrence.status)}
                                  >
                                    {occurrence.status}
                                  </Badge>
                                </td>
                                <td className="py-3">
                                  {occurrence.runId ? (
                                    <Link
                                      href={`/dashboard/runs/${occurrence.runId}`}
                                      className="font-medium underline underline-offset-4"
                                    >
                                      View Run
                                    </Link>
                                  ) : (
                                    occurrenceMessage(occurrence.status)
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {historyHasMore ? (
                          <Button
                            className="mt-3"
                            variant="ghost"
                            disabled={historyLoading}
                            onClick={() => void loadHistory(schedule.id, true)}
                          >
                            {historyLoading ? 'Loading…' : 'Load more'}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
