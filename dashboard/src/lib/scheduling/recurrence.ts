import { DateTime, IANAZone } from 'luxon';

export type RecurrenceDefinition = {
  kind: 'ONCE' | 'DAILY' | 'WEEKLY';
  timezone: string;
  localTime?: string | null;
  weekdays?: number[];
  oneTimeAt?: Date | null;
};

export function isValidTimezone(timezone: string) {
  return IANAZone.isValidZone(timezone);
}

function parseLocalTime(value: string | null | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) throw new Error('Local time must use HH:mm.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Local time is invalid.');
  return { hour, minute };
}

/**
 * Luxon shifts nonexistent wall times forward by the DST gap. For repeated
 * wall times, choosing the earliest possible instant makes the occurrence
 * deterministic and guarantees exactly one trigger.
 */
function localCandidate(
  date: DateTime,
  timezone: string,
  time: { hour: number; minute: number }
) {
  const candidate = DateTime.fromObject(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    },
    { zone: timezone }
  );
  if (!candidate.isValid) throw new Error('Unable to resolve local time.');
  const possibilities = candidate.getPossibleOffsets();
  return possibilities.reduce(
    (earliest, item) =>
      item.toMillis() < earliest.toMillis() ? item : earliest,
    candidate
  );
}

export function nextOccurrenceAfter(
  definition: RecurrenceDefinition,
  after: Date
): Date | null {
  if (!isValidTimezone(definition.timezone))
    throw new Error('Timezone is invalid.');
  if (definition.kind === 'ONCE')
    return definition.oneTimeAt && definition.oneTimeAt > after
      ? new Date(definition.oneTimeAt)
      : null;

  const time = parseLocalTime(definition.localTime);
  const weekdays = new Set(definition.weekdays ?? []);
  if (
    definition.kind === 'WEEKLY' &&
    (!weekdays.size || [...weekdays].some((day) => day < 1 || day > 7))
  ) {
    throw new Error('Weekly schedules require valid weekdays.');
  }
  const localAfter = DateTime.fromJSDate(after, { zone: definition.timezone });
  for (let offset = 0; offset <= 370; offset += 1) {
    const date = localAfter.startOf('day').plus({ days: offset });
    if (definition.kind === 'WEEKLY' && !weekdays.has(date.weekday)) continue;
    const candidate = localCandidate(date, definition.timezone, time);
    if (candidate.toMillis() > after.getTime())
      return candidate.toUTC().toJSDate();
  }
  throw new Error('Unable to calculate the next occurrence.');
}

export function occurrenceAtOrBefore(
  definition: RecurrenceDefinition,
  start: Date,
  end: Date
) {
  let latest: Date | null = null;
  let cursor = new Date(start.getTime() - 1);
  for (let count = 0; count < 10; count += 1) {
    const next = nextOccurrenceAfter(definition, cursor);
    if (!next || next > end) break;
    latest = next;
    cursor = next;
  }
  return latest;
}
