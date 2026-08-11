import { describe, expect, it, vi } from 'vitest';

import {
  getArtifactMaxBytesPerRun,
  normalizeExecutionTimeoutMs,
} from '../dashboard/src/lib/execution/configuration.js';
import {
  canTransitionRunStatus,
  isTerminalRunStatus,
} from '../dashboard/src/lib/execution/run-state.js';
import { withWallClockTimeout } from '../dashboard/src/lib/execution/timeout.js';
import { EventCollector } from '../dashboard/src/lib/browser/event-collector.js';

describe('Phase 3B run state model', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['RUNNING', 'SUCCESS'],
    ['RUNNING', 'FAILED'],
    ['RUNNING', 'TIMED_OUT'],
  ] as const)('allows %s to %s', (current, next) => {
    expect(canTransitionRunStatus(current, next)).toBe(true);
  });

  it.each(['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'] as const)(
    'rejects %s returning to RUNNING',
    (status) => {
      expect(canTransitionRunStatus(status, 'RUNNING')).toBe(false);
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  );

  it('treats same-state terminal persistence as idempotent', () => {
    expect(canTransitionRunStatus('SUCCESS', 'SUCCESS')).toBe(true);
    expect(canTransitionRunStatus('TIMED_OUT', 'TIMED_OUT')).toBe(true);
  });
});

describe('Phase 3B configuration bounds', () => {
  it('accepts timeout bounds and rejects unbounded values', () => {
    expect(normalizeExecutionTimeoutMs(5_000)).toBe(5_000);
    expect(normalizeExecutionTimeoutMs(900_000)).toBe(900_000);
    expect(() => normalizeExecutionTimeoutMs(4_999)).toThrow();
    expect(() => normalizeExecutionTimeoutMs(900_001)).toThrow();
  });

  it('validates the per-run artifact byte bound', () => {
    expect(getArtifactMaxBytesPerRun('1048576')).toBe(1_048_576);
    expect(() => getArtifactMaxBytesPerRun('100')).toThrow();
  });
});

describe('wall-clock timeout utility', () => {
  it('fires at the configured deadline and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const pending = new Promise<never>(() => undefined);
      const result = withWallClockTimeout(() => pending, 5_000, onTimeout);
      const rejection = expect(result).rejects.toMatchObject({
        name: 'ExecutionTimeoutError',
        timeoutMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(onTimeout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(onTimeout).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns early success and cancels the deadline', async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      await expect(
        withWallClockTimeout(() => Promise.resolve('done'), 5_000, onTimeout)
      ).resolves.toBe('done');
      expect(onTimeout).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('event listener lifecycle', () => {
  function fixture() {
    const handlers = new Map<string, (event: unknown) => void>();
    const removers = [vi.fn(), vi.fn(), vi.fn()];
    let index = 0;
    const collector = new EventCollector();
    collector.attach({
      eventbus: {
        on(name, handler) {
          handlers.set(name, handler);
          return removers[index++];
        },
      },
    });
    return { collector, handlers, removers };
  }

  it('removes all handlers and allows repeated detach', () => {
    const { collector, removers } = fixture();
    collector.detach();
    collector.detach();
    for (const remove of removers) expect(remove).toHaveBeenCalledOnce();
  });

  it('does not collect late events after detach', () => {
    const { collector, handlers } = fixture();
    collector.detach();
    handlers.get('CreateAgentStepEvent')?.({ step: 1 });
    expect(collector.toArray()).toEqual([]);
  });

  it('prevents duplicate attachment', () => {
    const { collector } = fixture();
    expect(() =>
      collector.attach({ eventbus: { on: () => undefined } })
    ).toThrow('already attached');
  });
});
