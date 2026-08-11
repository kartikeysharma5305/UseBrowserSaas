import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

const healthMocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { workerInstance: healthMocks },
}));

import { browserRunJobSchema } from '../dashboard/src/lib/queue/browser-run-job.js';
import { getQueueConfiguration } from '../dashboard/src/lib/queue/config.js';
import { drainBrowserWorker } from '../dashboard/src/lib/worker/worker-drain.js';
import {
  createWorkerInstanceId,
  heartbeatWorkerInstance,
  markLostWorkerInstances,
  registerWorkerInstance,
  stopWorkerInstance,
} from '../dashboard/src/lib/worker/worker-health.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.clearAllMocks();
  healthMocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('Phase 22 worker identity and health', () => {
  it('creates restart-unique bounded worker instance identities', () => {
    const first = createWorkerInstanceId();
    const second = createWorkerInstanceId();
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(180);
    expect(first).toMatch(/^[a-zA-Z0-9_.-]+$/);
  });

  it('records startup, active/draining heartbeat, stop, and stale loss', async () => {
    const now = new Date('2026-08-12T01:00:00Z');
    await registerWorkerInstance({
      id: 'worker-1',
      concurrency: 2,
      buildVersion: 'build-1',
      now,
    });
    expect(healthMocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'worker-1',
        status: 'STARTING',
        concurrency: 2,
        lastHeartbeatAt: now,
      }),
    });
    await expect(
      heartbeatWorkerInstance({
        id: 'worker-1',
        status: 'DRAINING',
        activeCount: 1,
        now,
      })
    ).resolves.toBe(true);
    await stopWorkerInstance('worker-1', now);
    await expect(markLostWorkerInstances(now)).resolves.toBe(1);
    expect(healthMocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['STARTING', 'ACTIVE', 'DRAINING'] },
        }),
        data: { status: 'LOST', activeCount: 0 },
      })
    );
  });
});

describe('Phase 22 bounded concurrency and drain', () => {
  it('supports canonical production settings and rejects invalid bounds', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.BROWSER_WORKER_CONCURRENCY = '4';
    process.env.WORKER_DRAIN_TIMEOUT_MS = '45000';
    const configuration = getQueueConfiguration();
    expect(configuration.concurrency).toBe(4);
    expect(configuration.shutdownGraceMs).toBe(45_000);

    process.env.BROWSER_WORKER_CONCURRENCY = '11';
    expect(() => getQueueConfiguration()).toThrow('BROWSER_WORKER_CONCURRENCY');
    process.env.BROWSER_WORKER_CONCURRENCY = '1';
    process.env.WORKER_DRAIN_TIMEOUT_MS = '999';
    expect(() => getQueueConfiguration()).toThrow('WORKER_DRAIN_TIMEOUT_MS');
  });

  it('pauses intake and closes cleanly when no execution is active', async () => {
    const worker = {
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      drainBrowserWorker({
        worker,
        activeCount: () => 0,
        abortActive: vi.fn(),
        drainTimeoutMs: 10,
        cleanupTimeoutMs: 10,
      })
    ).resolves.toEqual({ forced: false, cleanupCompleted: true });
    expect(worker.pause).toHaveBeenCalledWith(true);
    expect(worker.close).toHaveBeenCalledWith(false);
  });

  it('aborts only after grace and gives browser cleanup a second bound', async () => {
    let active = 1;
    const abort = vi.fn(() => {
      active = 0;
    });
    const worker = {
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      drainBrowserWorker({
        worker,
        activeCount: () => active,
        abortActive: abort,
        drainTimeoutMs: 5,
        cleanupTimeoutMs: 10,
      })
    ).resolves.toEqual({ forced: true, cleanupCompleted: true });
    expect(abort).toHaveBeenCalledOnce();
    expect(worker.close).toHaveBeenCalledWith(false);
  });

  it('force-closes delivery after both drain and cleanup bounds expire', async () => {
    const worker = {
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      drainBrowserWorker({
        worker,
        activeCount: () => 1,
        abortActive: vi.fn(),
        drainTimeoutMs: 5,
        cleanupTimeoutMs: 5,
      })
    ).resolves.toEqual({ forced: true, cleanupCompleted: false });
    expect(worker.close).toHaveBeenCalledWith(true);
  });
});

describe('Phase 22 multi-worker contracts', () => {
  it('rejects unsupported queue protocols before claiming a Run', () => {
    expect(
      browserRunJobSchema.safeParse({ version: 2, runId: 'run-1' }).success
    ).toBe(false);
  });

  it('keeps PostgreSQL leases authoritative and reconciliation lease-aware', () => {
    const lease = fs.readFileSync(
      'dashboard/src/lib/worker/run-lease.ts',
      'utf8'
    );
    const recovery = fs.readFileSync(
      'dashboard/scripts/recover-queue.ts',
      'utf8'
    );
    expect(lease).toContain('pg_advisory_xact_lock');
    expect(lease).toContain('leaseExpiresAt: { lt: now }');
    expect(lease).toContain('workerId');
    expect(recovery).toContain('run.leaseExpiresAt >= now');
    expect(recovery).toContain('pg_advisory_xact_lock');
    expect(recovery).toContain('enqueueBrowserRun(queue, run.id)');
  });

  it('closes browser resources on every outcome and exposes no worker DTO', () => {
    const engine = fs.readFileSync(
      'dashboard/src/lib/browser/engine.ts',
      'utf8'
    );
    const worker = fs.readFileSync(
      'dashboard/src/worker/browser-run-worker.ts',
      'utf8'
    );
    const publicRun = fs.readFileSync(
      'dashboard/src/lib/public-api/resources.ts',
      'utf8'
    );
    expect(engine).toContain('finally {');
    expect(engine).toContain('closeBrowserOnce');
    expect(engine).toContain('waitForCleanup');
    expect(worker).toContain("process.once('SIGTERM'");
    expect(worker).toContain("process.once('SIGINT'");
    expect(publicRun).not.toContain('workerId:');
  });
});
