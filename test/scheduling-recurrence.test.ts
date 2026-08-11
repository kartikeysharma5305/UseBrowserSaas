import { describe, expect, it } from 'vitest';

import {
  nextOccurrenceAfter,
  occurrenceAtOrBefore,
} from '../dashboard/src/lib/scheduling/recurrence.js';
import {
  createScheduleSchema,
  occurrencePaginationSchema,
} from '../dashboard/src/lib/scheduling/schemas.js';
import { getSchedulingEntitlement } from '../dashboard/src/lib/scheduling/entitlement.js';

describe('Phase 6C recurrence and timezone policy', () => {
  it('returns a future one-time occurrence once', () => {
    const at = new Date('2026-08-10T10:00:00Z');
    const rule = {
      kind: 'ONCE' as const,
      timezone: 'Asia/Kolkata',
      oneTimeAt: at,
    };
    expect(nextOccurrenceAfter(rule, new Date('2026-08-10T09:00:00Z'))).toEqual(
      at
    );
    expect(nextOccurrenceAfter(rule, at)).toBeNull();
  });

  it('preserves a daily Kolkata wall-clock time', () => {
    expect(
      nextOccurrenceAfter(
        { kind: 'DAILY', timezone: 'Asia/Kolkata', localTime: '09:15' },
        new Date('2026-08-06T03:00:00Z')
      )?.toISOString()
    ).toBe('2026-08-06T03:45:00.000Z');
  });

  it('selects only configured ISO weekdays', () => {
    expect(
      nextOccurrenceAfter(
        {
          kind: 'WEEKLY',
          timezone: 'UTC',
          localTime: '12:00',
          weekdays: [1, 3, 5],
        },
        new Date('2026-08-06T00:00:00Z')
      )?.toISOString()
    ).toBe('2026-08-07T12:00:00.000Z');
  });

  it('shifts a nonexistent spring-forward time by the DST gap', () => {
    expect(
      nextOccurrenceAfter(
        { kind: 'DAILY', timezone: 'America/New_York', localTime: '02:30' },
        new Date('2026-03-08T00:00:00Z')
      )?.toISOString()
    ).toBe('2026-03-08T07:30:00.000Z');
  });

  it('chooses the earliest instant for a repeated fall-back time', () => {
    expect(
      nextOccurrenceAfter(
        { kind: 'DAILY', timezone: 'America/New_York', localTime: '01:30' },
        new Date('2026-11-01T00:00:00Z')
      )?.toISOString()
    ).toBe('2026-11-01T05:30:00.000Z');
  });

  it('finds only the latest eligible occurrence in a bounded window', () => {
    expect(
      occurrenceAtOrBefore(
        { kind: 'DAILY', timezone: 'UTC', localTime: '10:00' },
        new Date('2026-08-05T12:00:00Z'),
        new Date('2026-08-06T12:00:00Z')
      )?.toISOString()
    ).toBe('2026-08-06T10:00:00.000Z');
  });
});

describe('Phase 6C schedule validation and plans', () => {
  const valid = {
    agentId: 'agent-1',
    kind: 'WEEKLY',
    timezone: 'Asia/Kolkata',
    localTime: '09:30',
    weekdays: [1, 5],
  };

  it('accepts a bounded weekly definition', () => {
    expect(createScheduleSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    { ...valid, timezone: 'Not/A_Zone' },
    { ...valid, localTime: '25:00' },
    { ...valid, weekdays: [0] },
    { ...valid, weekdays: [] },
    { ...valid, weekdays: [1, 2, 3, 4, 5, 6, 7, 7] },
  ])('rejects an invalid recurrence definition', (input) => {
    expect(createScheduleSchema.safeParse(input).success).toBe(false);
  });

  it('requires a one-time timestamp', () => {
    expect(
      createScheduleSchema.safeParse({
        agentId: 'agent-1',
        kind: 'ONCE',
        timezone: 'UTC',
      }).success
    ).toBe(false);
  });

  it('bounds occurrence pagination', () => {
    expect(occurrencePaginationSchema.safeParse({ limit: 100 }).success).toBe(
      true
    );
    expect(occurrencePaginationSchema.safeParse({ limit: 101 }).success).toBe(
      false
    );
  });

  it('centralizes FREE, PRO, and INTERNAL scheduling availability', () => {
    expect(getSchedulingEntitlement('FREE')).toEqual({
      enabled: false,
      maxActiveSchedules: 0,
    });
    expect(getSchedulingEntitlement('PRO').maxActiveSchedules).toBe(10);
    expect(getSchedulingEntitlement('INTERNAL').maxActiveSchedules).toBe(100);
  });
});
