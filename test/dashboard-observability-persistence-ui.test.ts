import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    run: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    agentEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
      aggregate: vi.fn(),
    },
    runArtifact: { createMany: vi.fn() },
    usageRecord: { createMany: vi.fn() },
  };
  return {
    transaction,
    runCreate: vi.fn(),
    eventCreate: vi.fn(),
    prismaTransaction: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    run: { findFirst: vi.fn() },
    agentEvent: { create: mocks.eventCreate },
    $transaction: mocks.prismaTransaction,
  },
}));
vi.mock('@/lib/realtime/run-notifications', () => ({
  publishRunNotification: vi.fn().mockResolvedValue(true),
}));

import { PrismaRunPersistence } from '../dashboard/src/lib/browser/run-persistence.js';

const startedAt = new Date('2026-01-01T00:00:00.000Z');
const events = [
  {
    sequence: 2,
    type: 'STEP_STARTED' as const,
    message: 'Task started.',
    data: { model: 'groq_test', cookies: 'discarded' } as never,
    timestamp: new Date('2026-01-01T00:00:01.000Z'),
  },
  {
    sequence: 3,
    type: 'STEP_COMPLETED' as const,
    message: 'Step complete.',
    data: { stepNumber: 1, actionSummary: 'navigate' },
    timestamp: new Date('2026-01-01T00:00:02.000Z'),
  },
];
const artifact = {
  id: 'artifact-1',
  type: 'SCREENSHOT' as const,
  storageKey: 'runs/run-1/opaque.png',
  storageProvider: 'LOCAL' as const,
  checksum: 'checksum',
  fileName: 'screenshot.png',
  mimeType: 'image/png' as const,
  size: 12,
  stepNumber: 1,
  eventSequence: 3,
};

describe('terminal run observability transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCreate.mockReturnValue({ operation: 'create-run' });
    mocks.eventCreate.mockReturnValue({ operation: 'create-start-event' });
    mocks.transaction.run.findFirst.mockResolvedValue(null);
    mocks.transaction.run.count.mockResolvedValue(0);
    mocks.transaction.run.create.mockImplementation(mocks.runCreate);
    mocks.transaction.agentEvent.create.mockImplementation(mocks.eventCreate);
    mocks.transaction.run.findUnique.mockResolvedValue({
      status: 'RUNNING',
      cancelRequestedAt: null,
      attempt: 1,
      agent: { userId: 'user-1' },
    });
    mocks.transaction.run.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.agentEvent.aggregate.mockResolvedValue({
      _max: { sequence: 1 },
    });
    mocks.prismaTransaction.mockImplementation(
      async (input: unknown[] | ((tx: typeof mocks.transaction) => unknown)) =>
        Array.isArray(input) ? input : input(mocks.transaction)
    );
  });

  it('persists event data in deterministic sequence order', async () => {
    await new PrismaRunPersistence().finalizeRun({
      runId: 'run-1',
      startedAt,
      status: 'SUCCESS',
      result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
      events: [...events].reverse(),
      artifacts: [artifact],
    });
    const data =
      mocks.transaction.agentEvent.createMany.mock.calls[0]?.[0].data;
    expect(data.map((event: { sequence: number }) => event.sequence)).toEqual([
      2, 3,
    ]);
  });

  it('persists artifact metadata without file contents', async () => {
    await new PrismaRunPersistence().finalizeRun({
      runId: 'run-1',
      startedAt,
      status: 'SUCCESS',
      result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
      events,
      artifacts: [artifact],
    });
    const payload =
      mocks.transaction.runArtifact.createMany.mock.calls[0]?.[0].data[0];
    expect(payload).toMatchObject({
      id: 'artifact-1',
      storageKey: 'runs/run-1/opaque.png',
      eventSequence: 3,
    });
    expect(JSON.stringify(payload)).not.toMatch(/base64|Buffer|absolute/);
  });

  it('links artifact IDs to the matching event data', async () => {
    await new PrismaRunPersistence().finalizeRun({
      runId: 'run-1',
      startedAt,
      status: 'SUCCESS',
      result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
      events,
      artifacts: [artifact],
    });
    const data =
      mocks.transaction.agentEvent.createMany.mock.calls[0]?.[0].data;
    expect(data[1].data.artifactIds).toEqual(['artifact-1']);
  });

  it('makes the terminal event last', async () => {
    await new PrismaRunPersistence().finalizeRun({
      runId: 'run-1',
      startedAt,
      status: 'SUCCESS',
      result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
      events,
      artifacts: [],
    });
    expect(
      mocks.transaction.agentEvent.upsert.mock.calls[0]?.[0]
    ).toMatchObject({
      where: { runId_sequence: { runId: 'run-1', sequence: 4 } },
      create: { sequence: 4, type: 'RUN_COMPLETED' },
    });
  });

  it('uses duplicate-safe event/artifact writes and terminal upsert', async () => {
    await new PrismaRunPersistence().finalizeRun({
      runId: 'run-1',
      startedAt,
      status: 'SUCCESS',
      result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
      events,
      artifacts: [artifact],
    });
    expect(
      mocks.transaction.agentEvent.createMany.mock.calls[0]?.[0].skipDuplicates
    ).toBe(true);
    expect(
      mocks.transaction.runArtifact.createMany.mock.calls[0]?.[0].skipDuplicates
    ).toBe(true);
    expect(mocks.transaction.agentEvent.upsert).toHaveBeenCalledOnce();
  });

  it('makes a repeated terminal update idempotent', async () => {
    mocks.transaction.run.findUnique.mockResolvedValue({
      status: 'SUCCESS',
      cancelRequestedAt: null,
      attempt: 1,
      agent: { userId: 'user-1' },
    });

    await expect(
      new PrismaRunPersistence().finalizeRun({
        runId: 'run-1',
        startedAt,
        status: 'SUCCESS',
        result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
        events,
        artifacts: [],
      })
    ).resolves.toBe(false);
    expect(mocks.transaction.run.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.agentEvent.upsert).not.toHaveBeenCalled();
  });

  it('prevents late success from overwriting TIMED_OUT', async () => {
    mocks.transaction.run.findUnique.mockResolvedValue({
      status: 'TIMED_OUT',
      cancelRequestedAt: null,
      attempt: 1,
      agent: { userId: 'user-1' },
    });

    await expect(
      new PrismaRunPersistence().finalizeRun({
        runId: 'run-1',
        startedAt,
        status: 'SUCCESS',
        result: { durationMs: 20, summary: 'Late', visitedUrls: [] },
        events,
        artifacts: [],
      })
    ).rejects.toThrow('TIMED_OUT to SUCCESS');
    expect(mocks.transaction.run.updateMany).not.toHaveBeenCalled();
  });

  it('prevents late success from overwriting a cancellation request', async () => {
    mocks.transaction.run.findUnique.mockResolvedValue({
      status: 'RUNNING',
      cancelRequestedAt: new Date(),
      attempt: 1,
      agent: { userId: 'user-1' },
    });

    await expect(
      new PrismaRunPersistence().finalizeRun({
        runId: 'run-1',
        startedAt,
        status: 'SUCCESS',
        result: { durationMs: 20, summary: 'Late', visitedUrls: [] },
        events,
        artifacts: [],
      })
    ).resolves.toBe(false);
    expect(mocks.transaction.run.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.agentEvent.upsert).not.toHaveBeenCalled();
  });

  it('persists one guarded CANCELED terminal event for the owning worker', async () => {
    mocks.transaction.run.findUnique.mockResolvedValue({
      status: 'RUNNING',
      workerId: 'worker-1',
      cancelRequestedAt: new Date(),
      attempt: 1,
      agent: { userId: 'user-1' },
    });

    await expect(
      new PrismaRunPersistence().markRunCanceled(
        'run-1',
        'worker-1',
        startedAt,
        events
      )
    ).resolves.toBe(true);
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        workerId: 'worker-1',
        cancelRequestedAt: { not: null },
      },
      data: expect.objectContaining({
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        workerId: null,
        leaseExpiresAt: null,
      }),
    });
    expect(mocks.transaction.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RUN_CANCELED',
        sequence: 4,
      }),
    });
  });

  it('persists timeout status, duration, and one terminal event', async () => {
    await new PrismaRunPersistence().markRunTimedOut(
      'run-1',
      startedAt,
      events
    );
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'TIMED_OUT',
        completedAt: expect.any(Date),
        duration: expect.any(Number),
        errorMessage: 'The agent run exceeded its time limit.',
      }),
    });
    expect(
      mocks.transaction.agentEvent.upsert.mock.calls[0]?.[0].create
    ).toMatchObject({
      type: 'RUN_FAILED',
      data: { success: false, status: 'TIMED_OUT' },
    });
  });

  it('does not mark false success when the terminal transaction cannot start', async () => {
    mocks.prismaTransaction.mockRejectedValueOnce(new Error('database failed'));
    await expect(
      new PrismaRunPersistence().finalizeRun({
        runId: 'run-1',
        startedAt,
        status: 'SUCCESS',
        result: { durationMs: 20, summary: 'Done', visitedUrls: [] },
        events,
        artifacts: [],
      })
    ).rejects.toThrow('database failed');
    expect(mocks.transaction.run.updateMany).not.toHaveBeenCalled();
  });

  it('persists only a safe failure message', async () => {
    await new PrismaRunPersistence().markRunFailed(
      'run-1',
      startedAt,
      'Prisma failed at C:\\private\\db with gsk_secretvalue'
    );
    expect(mocks.transaction.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'RUNNING',
        cancelRequestedAt: null,
      },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage:
          'The agent run failed. Review the run details for more information.',
      }),
    });
  });
});

describe('observable run UI wiring', () => {
  const dashboard = path.join(process.cwd(), 'dashboard');

  it('renders the timeline, gallery, and legacy empty states', () => {
    const source = fs.readFileSync(
      path.join(dashboard, 'src/components/dashboard/run-detail-client.tsx'),
      'utf8'
    );
    expect(source).toContain('Execution timeline');
    expect(source).toContain('Screenshots');
    expect(source).toContain('No events recorded for this run.');
    expect(source).toContain('No screenshots were captured.');
  });

  it('contains screenshot navigation and a full-size dialog', () => {
    const source = fs.readFileSync(
      path.join(dashboard, 'src/components/dashboard/run-detail-client.tsx'),
      'utf8'
    );
    expect(source).toContain('aria-label="Screenshot viewer"');
    expect(source).toContain('Previous screenshot');
    expect(source).toContain('Next screenshot');
  });

  it.each([
    'src/components/dashboard/run-table.tsx',
    'src/app/dashboard/page.tsx',
    'src/components/dashboard/agent-detail-client.tsx',
  ])('links runs to details from %s', (relativePath) => {
    const source = fs.readFileSync(path.join(dashboard, relativePath), 'utf8');
    expect(source).toContain('/dashboard/runs/${run.id}');
  });

  it('does not expose transient screenshot or raw output fields in execution types', () => {
    const source = fs.readFileSync(
      path.join(dashboard, 'src/lib/execution/types.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/\bbase64\b|\brawOutput\b|\bpath:/);
    expect(source).toContain('artifactCount');
    expect(source).toContain('detailsUrl');
  });
});
