import { describe, expect, it } from 'vitest';

import { presentRunDuration } from '@/lib/runs/duration';

describe('retried Run duration presentation', () => {
  it('shows logical wall-clock duration and preserves the final attempt duration', () => {
    expect(
      presentRunDuration({
        attempt: 2,
        createdAt: new Date('2026-08-11T17:52:15.781Z'),
        startedAt: new Date('2026-08-11T17:55:53.553Z'),
        completedAt: new Date('2026-08-11T17:55:53.709Z'),
        duration: 156,
      })
    ).toEqual({
      startedAt: new Date('2026-08-11T17:52:15.781Z'),
      duration: 217_928,
      attemptDuration: 156,
    });
  });

  it('leaves a single-attempt Run unchanged', () => {
    const startedAt = new Date('2026-08-11T17:52:15.781Z');
    expect(
      presentRunDuration({
        attempt: 1,
        createdAt: new Date('2026-08-11T17:52:15.700Z'),
        startedAt,
        completedAt: new Date('2026-08-11T17:52:16.000Z'),
        duration: 219,
      })
    ).toEqual({ startedAt, duration: 219, attemptDuration: null });
  });
});
