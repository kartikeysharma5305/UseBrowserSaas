import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { ExecutionServiceError } from '../dashboard/src/lib/execution/errors.js';
import { PrismaAgentExecutionService } from '../dashboard/src/lib/execution/prisma-agent-execution-service.js';
import { processDiscoveredOccurrence } from '../dashboard/src/lib/scheduling/processor.js';
import { SCHEDULER_POLICY } from '../dashboard/src/lib/scheduling/policy.js';

function database(options: { attempts?: number } = {}) {
  const occurrence = {
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    scheduledFor: new Date('2026-08-06T10:00:00Z'),
    status: 'DISCOVERED',
    attempts: options.attempts ?? 1,
    schedule: { id: 'schedule-1', userId: 'user-1', agentId: 'agent-1' },
  };
  return {
    scheduledOccurrence: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(occurrence),
      update: vi.fn().mockResolvedValue({}),
    },
    schedule: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as any;
}

describe('Phase 6C durable occurrence admission', () => {
  it('forwards trusted scheduling identity through the existing admission facade', async () => {
    const enqueue = vi
      .fn()
      .mockResolvedValue({ runId: 'scheduled-occurrence-1', status: 'QUEUED' });
    const service = new PrismaAgentExecutionService({ enqueue });
    const scheduled = {
      scheduleId: 'schedule-1',
      occurrenceId: 'occurrence-1',
      scheduledFor: new Date('2026-08-06T10:00:00Z'),
    };
    await service.runAgent({ agentId: 'agent-1', userId: 'user-1', scheduled });
    expect(enqueue).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
      scheduled,
    });
  });

  it('allows only one scheduler instance to claim an occurrence', async () => {
    const db = database();
    db.scheduledOccurrence.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const producer = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const now = new Date('2026-08-06T10:00:01Z');
    const results = await Promise.all([
      processDiscoveredOccurrence('occurrence-1', now, db, producer),
      processDiscoveredOccurrence('occurrence-1', now, db, producer),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(producer.enqueue).toHaveBeenCalledOnce();
  });

  it('recovers a discovered occurrence after a scheduler restart', async () => {
    const db = database();
    const producer = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    await expect(
      processDiscoveredOccurrence(
        'occurrence-1',
        new Date('2026-08-06T10:02:00Z'),
        db,
        producer
      )
    ).resolves.toBe(true);
    expect(db.scheduledOccurrence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              processingLeaseUntil: { lt: expect.any(Date) },
            }),
          ]),
        }),
      })
    );
  });

  it('records active-limit rejection without creating a placeholder Run', async () => {
    const db = database();
    const producer = {
      enqueue: vi
        .fn()
        .mockRejectedValue(new ExecutionServiceError('USER_RUN_LIMIT_REACHED')),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE_LIMIT_BLOCKED' }),
      })
    );
  });

  it('records monthly quota rejection distinctly', async () => {
    const db = database();
    const producer = {
      enqueue: vi
        .fn()
        .mockRejectedValue(
          new ExecutionServiceError('MONTHLY_RUN_LIMIT_REACHED')
        ),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUOTA_BLOCKED' }),
      })
    );
  });

  it('records monthly execution cost rejection without creating a Run', async () => {
    const db = database();
    const producer = {
      enqueue: vi
        .fn()
        .mockRejectedValue(
          new ExecutionServiceError('MONTHLY_EXECUTION_LIMIT_REACHED')
        ),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUOTA_BLOCKED' }),
      })
    );
  });

  it.each([
    ['SCHEDULING_NOT_AVAILABLE', 'PLAN_BLOCKED'],
    ['ACCOUNT_DELETION_IN_PROGRESS', 'ACCOUNT_BLOCKED'],
    ['AGENT_SCHEDULING_DISABLED', 'AGENT_BLOCKED'],
  ] as const)('records %s as %s', async (code, status) => {
    const db = database();
    const producer = {
      enqueue: vi.fn().mockRejectedValue(new ExecutionServiceError(code)),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) })
    );
  });

  it('leaves transient infrastructure failures retryable with bounded delay', async () => {
    const db = database({ attempts: 1 });
    const producer = {
      enqueue: vi.fn().mockRejectedValue(new Error('temporary')),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingLeaseUntil: null,
          nextAttemptAt: expect.any(Date),
          errorCode: 'SCHEDULE_ADMISSION_RETRY',
        }),
      })
    );
  });

  it('terminates admission retries at the centralized bound', async () => {
    const db = database({ attempts: SCHEDULER_POLICY.maxAdmissionAttempts });
    const producer = {
      enqueue: vi.fn().mockRejectedValue(new Error('temporary')),
    } as any;
    await processDiscoveredOccurrence('occurrence-1', new Date(), db, producer);
    expect(db.scheduledOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('keeps the BullMQ payload minimal and deterministic ID logic server-side', () => {
    const source = fs.readFileSync(
      'dashboard/src/lib/queue/run-producer.ts',
      'utf8'
    );
    const job = fs.readFileSync(
      'dashboard/src/lib/queue/browser-run-job.ts',
      'utf8'
    );
    expect(source).toContain('`scheduled-${input.scheduled.occurrenceId}`');
    expect(job).toContain('version: z.literal(1)');
    expect(job).not.toContain('scheduleId:');
  });

  it('uses a standalone process with bounded polling and graceful shutdown', () => {
    const source = fs.readFileSync(
      'dashboard/src/worker/schedule-worker.ts',
      'utf8'
    );
    expect(source).toContain('runSchedulerTick');
    expect(source).toContain("process.once('SIGTERM'");
    expect(SCHEDULER_POLICY.batchSize).toBe(50);
    expect(SCHEDULER_POLICY.pollIntervalMs).toBeGreaterThanOrEqual(10_000);
  });
});
