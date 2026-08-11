'use client';

import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type {
  ScheduleAgentOption,
  ScheduleKindValue,
  ScheduleView,
} from '@/lib/scheduling/client-types';
import {
  browserTimezone,
  formRecurrencePreview,
  oneTimeUtc,
  safeScheduleError,
  supportedTimezones,
  WEEKDAYS,
} from '@/lib/scheduling/presentation';
import { VariableValueFields } from '@/components/dashboard/agent-variable-fields';
import type { VariableValues } from '@/lib/variables/client-types';

const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

function initialOneTime(schedule?: ScheduleView) {
  if (schedule?.oneTimeAt) {
    const local = DateTime.fromISO(schedule.oneTimeAt).setZone(
      schedule.timezone
    );
    return {
      date: local.toFormat('yyyy-LL-dd'),
      time: local.toFormat('HH:mm'),
    };
  }
  const local = DateTime.local().plus({ minutes: 10 });
  return { date: local.toFormat('yyyy-LL-dd'), time: local.toFormat('HH:mm') };
}

export function ScheduleForm({
  agents,
  schedule,
  defaultAgentId,
  onSaved,
  onCancel,
}: {
  agents: ScheduleAgentOption[];
  schedule?: ScheduleView;
  defaultAgentId?: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const initial = initialOneTime(schedule);
  const [agentId, setAgentId] = useState(
    schedule?.agentId ?? defaultAgentId ?? agents[0]?.id ?? ''
  );
  const [kind, setKind] = useState<ScheduleKindValue>(schedule?.kind ?? 'ONCE');
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? browserTimezone()
  );
  const [date, setDate] = useState(initial.date);
  const [localTime, setLocalTime] = useState(
    schedule?.localTime ?? initial.time
  );
  const [weekdays, setWeekdays] = useState<number[]>(schedule?.weekdays ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variableValues, setVariableValues] = useState<VariableValues>(
    schedule?.variableValues ?? {}
  );
  const timezones = useMemo(supportedTimezones, []);
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const preview = formRecurrencePreview({
    kind,
    date,
    localTime,
    timezone,
    weekdays,
  });

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b)
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!agentId) return setError('Select an Agent.');
    if (!localTime) return setError('Select a local execution time.');
    if (kind === 'WEEKLY' && weekdays.length === 0)
      return setError('Select at least one weekday.');

    const oneTimeAt =
      kind === 'ONCE' ? oneTimeUtc(date, localTime, timezone) : null;
    if (kind === 'ONCE' && (!oneTimeAt || new Date(oneTimeAt) <= new Date()))
      return setError('Choose a one-time execution in the future.');

    const body = schedule
      ? {
          kind,
          timezone,
          localTime: kind === 'ONCE' ? null : localTime,
          weekdays: kind === 'WEEKLY' ? weekdays : [],
          oneTimeAt: kind === 'ONCE' ? oneTimeAt : null,
          version: schedule.version,
          variables: variableValues,
        }
      : {
          agentId,
          kind,
          timezone,
          ...(kind === 'ONCE'
            ? { oneTimeAt }
            : {
                localTime,
                ...(kind === 'WEEKLY' ? { weekdays } : {}),
              }),
          variables: variableValues,
        };

    setSubmitting(true);
    try {
      const response = await fetch(
        schedule ? `/api/schedules/${schedule.id}` : '/api/schedules',
        {
          method: schedule ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (response.status === 409)
          throw new Error(
            'This schedule changed elsewhere. Refresh and try again.'
          );
        throw new Error(safeScheduleError(payload, 'Unable to save schedule.'));
      }
      await onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to save schedule.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      className="p-5"
      role="region"
      aria-label={schedule ? 'Edit schedule' : 'Create schedule'}
    >
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {schedule ? 'Edit schedule' : 'Create schedule'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {schedule
            ? 'Changes apply only to future occurrences. Existing Runs are unchanged.'
            : 'Scheduled executions use the same quotas and Run pipeline as Run now.'}
        </p>
      </div>
      <form className="space-y-5" onSubmit={submit}>
        {!schedule ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Agent</span>
            <select
              aria-label="Agent"
              className={fieldClass}
              value={agentId}
              onChange={(event) => {
                setAgentId(event.target.value);
                setVariableValues({});
              }}
              required
            >
              <option value="">Select an Agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <fieldset>
          <legend className="text-sm font-medium">Recurrence</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['ONCE', 'DAILY', 'WEEKLY'] as const).map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {value === 'ONCE'
                  ? 'One time'
                  : value === 'DAILY'
                    ? 'Daily'
                    : 'Weekly'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          {kind === 'ONCE' ? (
            <label className="space-y-1">
              <span className="text-sm font-medium">Future date</span>
              <input
                aria-label="Future date"
                type="date"
                className={fieldClass}
                value={date}
                min={DateTime.local().toFormat('yyyy-LL-dd')}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="space-y-1">
            <span className="text-sm font-medium">Local time</span>
            <input
              aria-label="Local time"
              type="time"
              className={fieldClass}
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Timezone</span>
            <select
              aria-label="Timezone"
              className={fieldClass}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              required
            >
              {!timezones.includes(timezone) ? (
                <option value={timezone}>{timezone}</option>
              ) : null}
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>

        {kind === 'WEEKLY' ? (
          <fieldset>
            <legend className="text-sm font-medium">Weekdays</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label
                  key={day.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={weekdays.includes(day.value)}
                    onChange={() => toggleWeekday(day.value)}
                  />
                  {day.short}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {selectedAgent?.variables?.length ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Scheduled Run values
            </legend>
            <VariableValueFields
              variables={selectedAgent.variables}
              values={variableValues}
              onChange={setVariableValues}
              idPrefix="schedule-variable"
            />
            <p className="text-xs text-slate-500">
              Values are snapshotted on this Schedule. Secret variables cannot
              be scheduled.
            </p>
          </fieldset>
        ) : null}

        {schedule?.configurationErrorCode ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            This Schedule is paused until its variable values are updated.
          </p>
        ) : null}

        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/70">
          <p className="font-medium">Preview</p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{preview}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            The server remains authoritative for the next occurrence. Local
            wall-clock time is preserved; nonexistent DST times move forward by
            the gap and repeated times use the earliest instant once.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting
              ? 'Saving…'
              : schedule
                ? 'Save changes'
                : 'Create schedule'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
