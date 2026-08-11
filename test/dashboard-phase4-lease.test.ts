import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    run: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    agentEvent: {
      aggregate: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    usageRecord: { createMany: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(),
      run: {
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/realtime/run-notifications', () => ({
  publishRunNotification: vi.fn().mockResolvedValue(true),
}));

import {
  claimRun,
  failClaimedRun,
  heartbeatRun,
  recordClaimedRunModel,
  releaseRunForRetry,
} from '../dashboard/src/lib/worker/run-lease.js';

describe('Phase 4 PostgreSQL worker lease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction)
    );
    mocks.transaction.run.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.$executeRaw.mockResolvedValue(1);
    mocks.transaction.run.findUnique.mockResolvedValue({
      id: 'run-1',
      agentId: 'agent-1',
      startedAt: new Date(),
      attempt: 1,
      agent: {
        userId: 'user-1',
        goal: 'Safe goal',
        targetWebsite: 'https://example.com',
        configuration: {},
      },
    });
    mocks.transaction.run.findFirst.mockResolvedValue({
      id: 'run-1',
      startedAt: new Date(),
      attempt: 1,
      agent: { userId: 'user-1' },
    });
    mocks.transaction.agentEvent.aggregate.mockResolvedValue({
      _max: { sequence: 1 },
    });
    mocks.transaction.agentEvent.create.mockResolvedValue({});
    mocks.transaction.agentEvent.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.run.updateMany.mockResolvedValue({ count: 1 });
  });

  it('claims only queued or expired-leased runs and increments attempt', async () => {
    await expect(claimRun('run-1', 'worker-1', 20_000)).resolves.toMatchObject({
      id: 'run-1',
      attempt: 1,
      eventStartSequence: 3,
    });
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        cancelRequestedAt: null,
        OR: [
          { status: 'QUEUED' },
          {
            status: 'RUNNING',
            leaseExpiresAt: { lt: expect.any(Date) },
          },
        ],
      },
      data: expect.objectContaining({
        status: 'RUNNING',
        workerId: 'worker-1',
        attempt: { increment: 1 },
        heartbeatAt: expect.any(Date),
        leaseExpiresAt: expect.any(Date),
      }),
    });
  });

  it('does not claim a run while another valid lease owns it', async () => {
    mocks.transaction.run.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimRun('run-1', 'worker-2', 20_000)).resolves.toBeNull();
    expect(mocks.transaction.run.findUnique).not.toHaveBeenCalled();
  });

  it('records a durable worker-start event after claim', async () => {
    await claimRun('run-1', 'worker-1', 20_000);
    expect(mocks.transaction.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-1',
        sequence: 2,
        type: 'RUN_STARTED',
        data: { attempt: 1 },
      }),
    });
  });

  it('renews only the owning running lease', async () => {
    await expect(heartbeatRun('run-1', 'worker-1', 20_000)).resolves.toBe(true);
    expect(mocks.prisma.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        workerId: 'worker-1',
      },
      data: {
        heartbeatAt: expect.any(Date),
        leaseExpiresAt: expect.any(Date),
      },
    });
  });

  it('records the effective model only while the worker owns the lease', async () => {
    await expect(
      recordClaimedRunModel(
        'run-1',
        'worker-1',
        2,
        1,
        'groq_llama-3.3-70b-versatile'
      )
    ).resolves.toBe(true);
    expect(mocks.transaction.run.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        workerId: 'worker-1',
      },
      select: { id: true },
    });
    expect(mocks.transaction.agentEvent.updateMany).toHaveBeenCalledWith({
      where: { runId: 'run-1', sequence: 2, type: 'RUN_STARTED' },
      data: {
        data: {
          attempt: 1,
          model: 'groq_llama-3.3-70b-versatile',
        },
      },
    });
  });

  it('reports a rejected non-owner or terminal heartbeat', async () => {
    mocks.prisma.run.updateMany.mockResolvedValue({ count: 0 });
    await expect(heartbeatRun('run-1', 'worker-2', 20_000)).resolves.toBe(
      false
    );
  });

  it('releases ownership and returns to QUEUED for retry', async () => {
    await expect(
      releaseRunForRetry('run-1', 'worker-1', 'EXECUTION_UNAVAILABLE')
    ).resolves.toBe(true);
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        workerId: 'worker-1',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'QUEUED',
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        lastFailureCode: 'EXECUTION_UNAVAILABLE',
      }),
    });
  });

  it('does not append a retry event after losing ownership', async () => {
    mocks.transaction.run.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      releaseRunForRetry('run-1', 'worker-2', 'EXECUTION_UNAVAILABLE')
    ).resolves.toBe(false);
    expect(mocks.transaction.agentEvent.create).not.toHaveBeenCalled();
  });

  it('terminal failure clears all lease metadata', async () => {
    await expect(
      failClaimedRun('run-1', 'worker-1', 'EXECUTION_FAILED', 'Safe failure.')
    ).resolves.toBe(true);
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        workerId: 'worker-1',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Safe failure.',
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      }),
    });
  });
});
