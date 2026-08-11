import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    run: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    agentEvent: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    usageRecord: { createMany: vi.fn() },
  };
  const job = { remove: vi.fn() };
  return {
    transaction,
    job,
    prisma: {
      $transaction: vi.fn(),
    },
    queue: {
      getJob: vi.fn(),
    },
    publish: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/queue/browser-run-queue', () => ({
  getBrowserRunQueue: () => mocks.queue,
}));
vi.mock('@/lib/realtime/run-notifications', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../dashboard/src/lib/realtime/run-notifications.js')
    >();
  return {
    ...original,
    publishRunNotification: mocks.publish,
  };
});

import { cancelRunSchema } from '../dashboard/src/lib/api/schemas.js';
import {
  canTransitionRunStatus,
  isTerminalRunStatus,
} from '../dashboard/src/lib/execution/run-state.js';
import {
  acquireStreamLease,
  resetStreamConnectionCountsForTests,
} from '../dashboard/src/lib/realtime/connection-limits.js';
import { getRealtimeConfiguration } from '../dashboard/src/lib/realtime/config.js';
import { parseRunNotification } from '../dashboard/src/lib/realtime/run-notifications.js';
import {
  cancelOwnedRun,
  RunNotFoundError,
} from '../dashboard/src/lib/runs/run-cancellation.js';
import { RunCancellationError } from '../dashboard/src/lib/runs/cancellation-types.js';
import { withWallClockTimeout } from '../dashboard/src/lib/execution/timeout.js';
import { ActiveRunRegistry } from '../dashboard/src/lib/worker/active-run-registry.js';

describe('Phase 5 cancellation state and service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction)
    );
    mocks.transaction.$executeRaw.mockResolvedValue(1);
    mocks.transaction.run.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.agentEvent.aggregate.mockResolvedValue({
      _max: { sequence: 2 },
    });
    mocks.transaction.agentEvent.create.mockResolvedValue({});
    mocks.queue.getJob.mockResolvedValue(mocks.job);
    mocks.job.remove.mockResolvedValue(undefined);
    mocks.publish.mockResolvedValue(true);
  });

  it.each([
    ['QUEUED', 'CANCELED'],
    ['RUNNING', 'CANCELED'],
  ] as const)('allows %s to CANCELED', (current, next) => {
    expect(canTransitionRunStatus(current, next)).toBe(true);
    expect(isTerminalRunStatus(next)).toBe(true);
  });

  it('atomically cancels an owned queued run and removes its job', async () => {
    mocks.transaction.run.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'QUEUED',
      startedAt: new Date(),
      cancelRequestedAt: null,
    });
    await expect(
      cancelOwnedRun('run-1', 'user-1', 'No longer needed')
    ).resolves.toMatchObject({
      status: 'CANCELED',
      cancelRequested: true,
      alreadyTerminal: false,
    });
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'QUEUED',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'CANCELED',
        canceledByUserId: 'user-1',
        cancelReason: 'No longer needed',
        queueJobId: null,
      }),
    });
    expect(mocks.transaction.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RUN_CANCELED',
        sequence: 3,
      }),
    });
    expect(mocks.job.remove).toHaveBeenCalledOnce();
  });

  it('records a running request without removing an active job', async () => {
    mocks.transaction.run.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      startedAt: new Date(),
      cancelRequestedAt: null,
    });
    await expect(cancelOwnedRun('run-1', 'user-1')).resolves.toMatchObject({
      status: 'RUNNING',
      cancelRequested: true,
      alreadyTerminal: false,
    });
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        canceledByUserId: 'user-1',
        cancelRequestedAt: expect.any(Date),
      }),
    });
    expect(mocks.job.remove).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledWith('run-1', 'cancel');
  });

  it('returns identical service errors for missing and cross-user runs', async () => {
    mocks.transaction.run.findFirst.mockResolvedValue(null);
    await expect(cancelOwnedRun('missing', 'user-1')).rejects.toBeInstanceOf(
      RunNotFoundError
    );
    await expect(cancelOwnedRun('cross-user', 'user-1')).rejects.toBeInstanceOf(
      RunNotFoundError
    );
  });

  it('keeps terminal cancellation idempotent without another event', async () => {
    mocks.transaction.run.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'CANCELED',
      startedAt: new Date(),
      cancelRequestedAt: new Date(),
    });
    await expect(cancelOwnedRun('run-1', 'user-1')).resolves.toMatchObject({
      status: 'CANCELED',
      alreadyTerminal: true,
    });
    expect(mocks.transaction.run.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.agentEvent.create).not.toHaveBeenCalled();
  });

  it('bounds and sanitizes optional reasons', () => {
    expect(cancelRunSchema.parse({ reason: '  stop\u0000 now  ' }).reason).toBe(
      'stop now'
    );
    expect(cancelRunSchema.safeParse({ reason: 'x'.repeat(241) }).success).toBe(
      false
    );
  });
});

describe('Phase 5 worker cancellation controls', () => {
  it('targets one registered run and unregisters idempotently', () => {
    const registry = new ActiveRunRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const unregister = registry.register('run-1', first);
    registry.register('run-2', second);
    expect(registry.requestCancellation('run-1')).toBe(true);
    expect(first.signal.reason).toBeInstanceOf(RunCancellationError);
    expect(second.signal.aborted).toBe(false);
    unregister();
    unregister();
    expect(registry.has('run-1')).toBe(false);
  });

  it('preserves the cancellation reason through the abort helper', async () => {
    const controller = new AbortController();
    const onStop = vi.fn();
    const pending = withWallClockTimeout(
      () => new Promise<never>(() => undefined),
      60_000,
      onStop,
      controller.signal
    );
    controller.abort(new RunCancellationError('run-1'));
    await expect(pending).rejects.toBeInstanceOf(RunCancellationError);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('validates Redis messages and rejects expanded payloads', () => {
    expect(
      parseRunNotification(
        JSON.stringify({ version: 1, runId: 'run-1', kind: 'cancel' })
      )
    ).toEqual({ version: 1, runId: 'run-1', kind: 'cancel' });
    expect(
      parseRunNotification(
        JSON.stringify({
          version: 1,
          runId: 'run-1',
          kind: 'cancel',
          task: 'secret',
        })
      )
    ).toBeNull();
  });
});

describe('Phase 5 stream bounds and contracts', () => {
  beforeEach(() => resetStreamConnectionCountsForTests());

  it('enforces per-user and per-run connection limits', () => {
    const first = acquireStreamLease('user-1', 'run-1', 2, 1);
    expect(first).not.toBeNull();
    expect(acquireStreamLease('user-1', 'run-1', 2, 1)).toBeNull();
    const second = acquireStreamLease('user-1', 'run-2', 2, 1);
    expect(second).not.toBeNull();
    expect(acquireStreamLease('user-1', 'run-3', 2, 1)).toBeNull();
    first?.release();
    expect(acquireStreamLease('user-1', 'run-3', 2, 1)).not.toBeNull();
  });

  it('bounds all realtime environment settings', () => {
    const previous = process.env.SSE_HEARTBEAT_MS;
    process.env.SSE_HEARTBEAT_MS = '4999';
    expect(() => getRealtimeConfiguration()).toThrow('SSE_HEARTBEAT_MS');
    if (previous === undefined) delete process.env.SSE_HEARTBEAT_MS;
    else process.env.SSE_HEARTBEAT_MS = previous;
  });

  it('implements ownership, replay, fallback, and safe SSE fields', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'dashboard/src/app/api/runs/[id]/stream/route.ts'
      ),
      'utf8'
    );
    expect(source).toContain('agent: { userId: user.id }');
    expect(source).toContain("request.headers.get('last-event-id')");
    expect(source).toContain('sequence: { gt: eventCursor }');
    expect(source).toContain('fallbackPollMs');
    expect(source).toContain("'X-Accel-Buffering': 'no'");
    expect(source).not.toMatch(/storageKey|workerId|leaseExpiresAt|queueJobId/);
  });

  it('wires EventSource, deduplication, fallback, and confirmation UI', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'dashboard/src/components/dashboard/run-detail-client.tsx'
      ),
      'utf8'
    );
    expect(source).toContain('new EventSource');
    expect(source).toContain("source.addEventListener('agent-event'");
    expect(source).toContain("source.addEventListener('run-artifact'");
    expect(source).toContain('fallbackPoll = setInterval');
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('Cancel run');
    expect(source).toContain("run.status === 'CANCELED'");
  });
});
