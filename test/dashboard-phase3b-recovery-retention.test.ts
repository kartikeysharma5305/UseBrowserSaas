import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  runUpdateMany: vi.fn(),
  eventAggregate: vi.fn(),
  eventCreate: vi.fn(),
  artifactFindMany: vi.fn(),
  artifactDeleteMany: vi.fn(),
  transaction: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    run: { findMany: mocks.runFindMany },
    runArtifact: {
      findMany: mocks.artifactFindMany,
      deleteMany: mocks.artifactDeleteMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/logger', () => ({ logger: mocks.logger }));

import { cleanupExpiredArtifacts } from '../dashboard/src/lib/browser/artifact-retention.js';
import { recoverStaleRuns } from '../dashboard/src/lib/execution/stale-run-recovery.js';

const now = new Date('2026-07-25T00:00:00.000Z');
const staleRun = {
  id: 'run-stale',
  status: 'RUNNING' as const,
  startedAt: new Date('2026-07-24T00:00:00.000Z'),
  agentId: 'agent-1',
  attempt: 1,
  agent: { userId: 'user-1' },
};

describe('stale run recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runFindMany.mockResolvedValue([]);
    mocks.runUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventAggregate.mockResolvedValue({ _max: { sequence: 4 } });
    mocks.eventCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(
      (callback: (transaction: unknown) => unknown) =>
        callback({
          run: { updateMany: mocks.runUpdateMany },
          agentEvent: {
            aggregate: mocks.eventAggregate,
            create: mocks.eventCreate,
          },
          usageRecord: { createMany: vi.fn() },
        })
    );
  });

  it('recovers an old RUNNING run as TIMED_OUT with completion data', async () => {
    mocks.runFindMany.mockResolvedValue([staleRun]);

    await expect(
      recoverStaleRuns({ now, thresholdMs: 60_000 })
    ).resolves.toEqual({ inspected: 1, recovered: 1 });
    expect(mocks.runUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-stale',
        status: 'RUNNING',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'TIMED_OUT',
        completedAt: now,
        duration: expect.any(Number),
      }),
    });
  });

  it('adds one ordered safe recovery event', async () => {
    mocks.runFindMany.mockResolvedValue([staleRun]);
    await recoverStaleRuns({ now, thresholdMs: 60_000 });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-stale',
        sequence: 5,
        type: 'RUN_FAILED',
        data: {
          success: false,
          status: 'TIMED_OUT',
          recovered: true,
        },
      }),
    });
  });

  it('preserves recent and terminal runs through the active/cutoff query', async () => {
    await expect(
      recoverStaleRuns({ now, thresholdMs: 60_000 })
    ).resolves.toEqual({ inspected: 0, recovered: 0 });
    expect(mocks.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['QUEUED', 'RUNNING'] },
          startedAt: { lt: new Date('2026-07-24T23:59:00.000Z') },
        }),
      })
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('scopes lazy recovery to the authenticated user', async () => {
    await recoverStaleRuns({
      userId: 'user-1',
      now,
      thresholdMs: 60_000,
    });
    expect(mocks.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agent: { userId: 'user-1' },
        }),
      })
    );
  });

  it('does not append an event when a concurrent terminal update wins', async () => {
    mocks.runFindMany.mockResolvedValue([staleRun]);
    mocks.runUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      recoverStaleRuns({ now, thresholdMs: 60_000 })
    ).resolves.toEqual({ inspected: 1, recovered: 0 });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
});

describe('artifact retention', () => {
  const artifact = {
    id: 'artifact-1',
    runId: 'run-1',
    storageKey: 'runs/run-1/file.png',
    size: 100,
    storageProvider: 'LOCAL',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    run: {
      agent: {
        user: { planCode: 'FREE' },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artifactFindMany.mockResolvedValue([artifact]);
    mocks.artifactDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('dry-run selects expired artifacts but deletes nothing', async () => {
    const storage = { delete: vi.fn() } as never;
    const result = await cleanupExpiredArtifacts({
      dryRun: true,
      now,
      retentionDays: 30,
      storage,
    });
    expect(result).toMatchObject({ eligible: 1, deleted: 0, dryRun: true });
    expect(
      (storage as { delete: ReturnType<typeof vi.fn> }).delete
    ).not.toHaveBeenCalled();
    expect(mocks.artifactDeleteMany).not.toHaveBeenCalled();
  });

  it('deletes the file before its metadata and reports reclaimed bytes', async () => {
    const order: string[] = [];
    const storage = {
      delete: vi.fn(async () => {
        order.push('file');
      }),
    } as never;
    mocks.artifactDeleteMany.mockImplementation(async () => {
      order.push('metadata');
      return { count: 1 };
    });

    const result = await cleanupExpiredArtifacts({
      dryRun: false,
      now,
      retentionDays: 30,
      storage,
    });
    expect(order).toEqual(['file', 'metadata']);
    expect(result).toMatchObject({
      deleted: 1,
      failed: 0,
      bytesReclaimed: 100,
    });
  });

  it('retains metadata when file deletion fails', async () => {
    const storage = {
      delete: vi.fn().mockRejectedValue(new Error('permission denied')),
    } as never;
    const result = await cleanupExpiredArtifacts({
      dryRun: false,
      now,
      retentionDays: 30,
      storage,
    });
    expect(result.failed).toBe(1);
    expect(mocks.artifactDeleteMany).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledOnce();
  });

  it('treats missing files as safely deletable when storage delete is idempotent', async () => {
    const storage = { delete: vi.fn().mockResolvedValue(undefined) } as never;
    const result = await cleanupExpiredArtifacts({
      dryRun: false,
      now,
      retentionDays: 30,
      storage,
    });
    expect(result.deleted).toBe(1);
    expect(mocks.artifactDeleteMany).toHaveBeenCalledWith({
      where: {
        id: 'artifact-1',
        storageKey: 'runs/run-1/file.png',
      },
    });
  });

  it('excludes active runs and retains recent artifacts in the query', async () => {
    mocks.artifactFindMany.mockResolvedValue([]);
    await cleanupExpiredArtifacts({
      dryRun: true,
      now,
      retentionDays: 30,
      storage: { delete: vi.fn() } as never,
    });
    expect(mocks.artifactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { lt: new Date('2026-06-25T00:00:00.000Z') },
          run: { status: { notIn: ['QUEUED', 'RUNNING'] } },
        },
      })
    );
  });
});
