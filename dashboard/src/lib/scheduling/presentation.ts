import { DateTime } from 'luxon';

import type {
  OccurrenceStatusValue,
  ScheduleKindValue,
  ScheduleView,
} from './client-types';

export const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
] as const;

export const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export function browserTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && DateTime.local().setZone(zone).isValid ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  try {
    const zones = intl.supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES;
    return Array.from(new Set(['UTC', ...zones])).sort();
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

export function recurrenceSummary(
  schedule: Pick<
    ScheduleView,
    'kind' | 'localTime' | 'weekdays' | 'oneTimeAt' | 'timezone'
  >
): string {
  if (schedule.kind === 'ONCE')
    return schedule.oneTimeAt
      ? `Once on ${DateTime.fromISO(schedule.oneTimeAt)
          .setZone(schedule.timezone)
          .toFormat('yyyy-LL-dd HH:mm')}`
      : 'One time';
  if (schedule.kind === 'DAILY') return `Daily at ${schedule.localTime}`;
  const days = schedule.weekdays
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.short)
    .filter(Boolean)
    .join(', ');
  return `${days || 'Selected weekdays'} at ${schedule.localTime}`;
}

export function formRecurrencePreview(input: {
  kind: ScheduleKindValue;
  date: string;
  localTime: string;
  timezone: string;
  weekdays: number[];
}): string {
  if (input.kind === 'ONCE') {
    if (!input.date || !input.localTime)
      return 'Choose a future date and time.';
    const instant = DateTime.fromISO(`${input.date}T${input.localTime}`, {
      zone: input.timezone,
    });
    if (!instant.isValid) return 'Choose a valid date, time and timezone.';
    return `Once at ${input.localTime} in ${input.timezone} (${instant
      .toUTC()
      .toFormat("yyyy-LL-dd HH:mm 'UTC'")}).`;
  }
  if (input.kind === 'DAILY')
    return `Every day at ${input.localTime || '—'} in ${input.timezone}.`;
  const days = input.weekdays
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label)
    .filter(Boolean)
    .join(', ');
  return `Every ${days || 'selected weekday'} at ${
    input.localTime || '—'
  } in ${input.timezone}.`;
}

export function oneTimeUtc(
  date: string,
  localTime: string,
  timezone: string
): string | null {
  const value = DateTime.fromISO(`${date}T${localTime}`, { zone: timezone });
  return value.isValid ? value.toUTC().toISO() : null;
}

const OCCURRENCE_MESSAGES: Record<OccurrenceStatusValue, string> = {
  DISCOVERED: 'Discovered and awaiting admission.',
  ADMITTED: 'Admitted to the execution queue.',
  SKIPPED: 'Skipped by request.',
  QUOTA_BLOCKED: 'Monthly run quota was exhausted.',
  ACTIVE_LIMIT_BLOCKED: 'The active-run limit was reached.',
  PLAN_BLOCKED: 'The current plan does not allow scheduling.',
  ACCOUNT_BLOCKED: 'Account state prevented admission.',
  AGENT_BLOCKED: 'The Agent was unavailable or disabled.',
  MISSED: 'The occurrence expired outside the recovery window.',
  CANCELED: 'Canceled before admission.',
  FAILED: 'Admission could not be completed. Retry or refresh later.',
};

export function occurrenceMessage(status: OccurrenceStatusValue): string {
  return OCCURRENCE_MESSAGES[status] ?? 'Occurrence status unavailable.';
}

export function safeScheduleError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  return typeof error === 'string' && error.length <= 240 ? error : fallback;
}
