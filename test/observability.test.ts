import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  user: vi.fn(),
}));

vi.mock('@/lib/api/route-helpers', () => ({
  requireAuthenticatedUser: authMocks.user,
}));

import { ExecutionServiceError } from '../dashboard/src/lib/execution/errors.js';
import { PrismaAgentExecutionService } from '../dashboard/src/lib/execution/prisma-agent-execution-service.js';
import { logger } from '../dashboard/src/lib/logger.js';
import { authorizeOperatorRequest } from '../dashboard/src/lib/operations/access.js';
import { checkReadiness } from '../dashboard/src/lib/operations/health.js';
import {
  getCounterSamples,
  incrementCounter,
  renderPrometheus,
  resetOperationsMetricsForTests,
} from '../dashboard/src/lib/operations/metrics.js';
import { recordSecurityRejection } from '../dashboard/src/lib/operations/signals.js';
import {
  operationalSeverity,
  safeQueueSnapshot,
  snapshotPrometheusSamples,
  statusCounts,
  summarizeRuns,
  summarizeWorkers,
  type OperationsSnapshot,
} from '../dashboard/src/lib/operations/snapshot.js';

const originalEnvironment = { ...process.env };

beforeEach(() => {
  resetOperationsMetricsForTests();
  authMocks.user.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

describe('Phase 23 bounded metrics', () => {
  it('increments only approved counter dimensions', () => {
    incrementCounter('security_rejections_total', {
      control: 'auth_rate_limit',
    });
    incrementCounter('security_rejections_total', {
      control: 'auth_rate_limit',
    });
    expect(getCounterSamples()).toEqual([
      {
        name: 'security_rejections_total',
        labels: { control: 'auth_rate_limit' },
        value: 2,
      },
    ]);
    expect(() =>
      incrementCounter('security_rejections_total', {
        control: 'https://attacker.invalid/private',
      })
    ).toThrow('Invalid bounded metric label');
    expect(() =>
      incrementCounter('security_rejections_total', {
        control: 'origin',
        runId: 'run-secret',
      })
    ).toThrow('Unexpected metric labels');
  });

  it('records admission and security rejection signals once at their boundary', async () => {
    const service = new PrismaAgentExecutionService({
      enqueue: vi
        .fn()
        .mockRejectedValue(new ExecutionServiceError('RUN_RATE_LIMITED')),
    } as never);
    await expect(
      service.runAgent({ agentId: 'agent', userId: 'user' })
    ).rejects.toBeInstanceOf(ExecutionServiceError);
    recordSecurityRejection('oversized_body');
    expect(getCounterSamples()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'run_admission_rejections_total',
          labels: { reason: 'other' },
          value: 1,
        }),
        expect.objectContaining({
          name: 'security_rejections_total',
          labels: { control: 'run_burst_limit' },
          value: 1,
        }),
        expect.objectContaining({
          name: 'security_rejections_total',
          labels: { control: 'oversized_body' },
          value: 1,
        }),
      ])
    );
  });

  it('renders bounded Prometheus text without secret or high-cardinality fields', () => {
    const marker = 'secret-user@example.invalid';
    const output = renderPrometheus([
      {
        name: 'runs_completed_total',
        value: 2,
        labels: { status: 'success' },
        type: 'counter',
      },
    ]);
    expect(output).toContain('runs_completed_total{status="success"} 2');
    expect(output).not.toContain(marker);
    expect(output).not.toMatch(/runId|agentId|api.?key|https?:\/\//i);
    expect(output.length).toBeLessThan(2_000);
  });
});

describe('Phase 23 derived operational metrics', () => {
  const now = new Date('2026-08-10T10:00:00Z');

  it('separates outcomes, retry count, queue wait, and duration', () => {
    const result = summarizeRuns(
      [
        {
          status: 'SUCCESS',
          queuedAt: new Date('2026-08-10T09:59:50Z'),
          startedAt: new Date('2026-08-10T09:59:55Z'),
          duration: 2_000,
          attempt: 2,
        },
        {
          status: 'FAILED',
          queuedAt: new Date('2026-08-10T09:59:40Z'),
          startedAt: new Date('2026-08-10T09:59:45Z'),
          duration: 4_000,
          attempt: 1,
        },
        {
          status: 'TIMED_OUT',
          queuedAt: null,
          startedAt: now,
          duration: null,
          attempt: 1,
        },
        {
          status: 'CANCELED',
          queuedAt: null,
          startedAt: now,
          duration: 0,
          attempt: 0,
        },
      ],
      now
    );
    expect(result.outcomes).toMatchObject({
      SUCCESS: 1,
      FAILED: 1,
      TIMED_OUT: 1,
      CANCELED: 1,
    });
    expect(result.retries).toBe(1);
    expect(result.averageQueueWaitMs).toBe(5_000);
    expect(result.averageDurationMs).toBe(2_000);
  });

  it('summarizes active, draining, and lost workers without identities', () => {
    expect(
      summarizeWorkers(
        [
          {
            status: 'ACTIVE',
            concurrency: 3,
            activeCount: 2,
            lastHeartbeatAt: new Date(now.getTime() - 1_000),
          },
          {
            status: 'DRAINING',
            concurrency: 2,
            activeCount: 1,
            lastHeartbeatAt: new Date(now.getTime() - 2_000),
          },
          {
            status: 'LOST',
            concurrency: 1,
            activeCount: 0,
            lastHeartbeatAt: new Date(now.getTime() - 3_000),
          },
        ],
        now
      )
    ).toEqual({
      statuses: { STARTING: 0, ACTIVE: 1, DRAINING: 1, LOST: 1 },
      configuredCapacity: 3,
      activeExecutions: 3,
      oldestHeartbeatAgeMs: 3_000,
    });
  });

  it('returns safe queue counts and marks failures unavailable', async () => {
    await expect(
      safeQueueSnapshot({
        getJobCounts: vi.fn().mockResolvedValue({
          waiting: 3,
          active: 2,
          delayed: 1,
          failed: 4,
          paused: 0,
        }),
      })
    ).resolves.toMatchObject({ available: true, waiting: 3, active: 2 });
    await expect(
      safeQueueSnapshot({
        getJobCounts: vi.fn().mockRejectedValue(new Error('secret redis url')),
      })
    ).resolves.toEqual({
      available: false,
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
    });
  });

  it('maps notification and webhook delivery states without recipient or URL labels', () => {
    expect(
      statusCounts([
        { status: 'SENT', _count: { _all: 3 } },
        { status: 'FAILED', _count: { _all: 1 } },
      ])
    ).toEqual({ SENT: 3, FAILED: 1 });
  });

  it('evaluates alert-ready severity deterministically', () => {
    expect(
      operationalSeverity({
        activeWorkers: 0,
        queueAvailable: true,
        waiting: 1,
        oldestQueueWaitMs: 1,
        failedRuns: 0,
        completedRuns: 0,
        schedulerHeartbeatAt: null,
        now,
      })
    ).toBe('CRITICAL');
    expect(
      operationalSeverity({
        activeWorkers: 1,
        queueAvailable: true,
        waiting: 0,
        oldestQueueWaitMs: 61_000,
        failedRuns: 0,
        completedRuns: 10,
        schedulerHeartbeatAt: now.toISOString(),
        now,
      })
    ).toBe('DEGRADED');
  });
});

describe('Phase 23 health and operator boundary', () => {
  it('keeps core readiness independent of third-party providers', async () => {
    await expect(
      checkReadiness({
        database: vi.fn().mockResolvedValue(1),
        redis: vi.fn().mockResolvedValue('PONG'),
      })
    ).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok' },
    });
    await expect(
      checkReadiness({
        database: vi.fn().mockRejectedValue(new Error('down')),
        redis: vi.fn().mockResolvedValue('PONG'),
      })
    ).resolves.toEqual({
      status: 'not_ready',
      checks: { database: 'unavailable', redis: 'ok' },
    });
  });

  it('denies public and FREE/PRO access and permits token or INTERNAL access', async () => {
    delete process.env.OBSERVABILITY_TOKEN;
    authMocks.user.mockResolvedValue({ planCode: 'FREE' });
    await expect(
      authorizeOperatorRequest(new Request('http://localhost/internal'))
    ).resolves.toEqual({ ok: false });
    authMocks.user.mockResolvedValue({ planCode: 'PRO' });
    await expect(
      authorizeOperatorRequest(new Request('http://localhost/internal'))
    ).resolves.toEqual({ ok: false });
    authMocks.user.mockResolvedValue({ planCode: 'INTERNAL' });
    await expect(
      authorizeOperatorRequest(new Request('http://localhost/internal'))
    ).resolves.toMatchObject({ ok: true, via: 'session' });

    process.env.OBSERVABILITY_TOKEN = 'o'.repeat(40);
    authMocks.user.mockResolvedValue(null);
    await expect(
      authorizeOperatorRequest(
        new Request('http://localhost/internal', {
          headers: { authorization: `Bearer ${'o'.repeat(40)}` },
        })
      )
    ).resolves.toEqual({ ok: true, via: 'token' });
  });

  it('emits structured redacted operational logs', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logger.operation('info', {
      component: 'security',
      event: 'rate_limited',
      authorization: 'Bearer secret-marker',
    });
    const output = String(spy.mock.calls[0]?.[0]);
    expect(output).toContain('"component":"security"');
    expect(output).toContain('"event":"rate_limited"');
    expect(output).toContain('[redacted]');
    expect(output).not.toContain('secret-marker');
  });
});

describe('Phase 23 Prometheus snapshot contract', () => {
  it('exports run, queue, worker, scheduler, delivery, billing, and usage metrics', () => {
    const snapshot = {
      generatedAt: '2026-08-10T10:00:00.000Z',
      window: '24h',
      severity: 'OK',
      runs: {
        active: 1,
        queued: 2,
        outcomes: { SUCCESS: 2, FAILED: 1, TIMED_OUT: 0, CANCELED: 0 },
        totals: { SUCCESS: 20, FAILED: 4 },
        admittedTotal: 30,
        startedTotal: 26,
        retryTotal: 2,
        retries: 1,
        recoveries: 1,
        averageDurationMs: 100,
        averageQueueWaitMs: 20,
        oldestQueueWaitMs: 30,
      },
      queues: Object.fromEntries(
        ['browser', 'notifications', 'webhooks'].map((name) => [
          name,
          {
            available: true,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            paused: 0,
          },
        ])
      ),
      workers: {
        statuses: { ACTIVE: 2, DRAINING: 0, LOST: 0 },
        configuredCapacity: 4,
        activeExecutions: 1,
        oldestHeartbeatAgeMs: 1_000,
      },
      scheduler: {
        occurrences: { ADMITTED: 2, QUOTA_BLOCKED: 1 },
        lastHeartbeatAt: '2026-08-10T10:00:00.000Z',
      },
      notifications: {
        statuses: { SENT: 2, FAILED: 1 },
        averageDeliveryMs: 10,
        retrying: 0,
      },
      webhooks: {
        statuses: { DELIVERED: 2, FAILED: 1 },
        averageDeliveryMs: 10,
        retrying: 0,
        rateLimited: 0,
        disabledEndpoints: 0,
      },
      billing: { webhookStatuses: { PROCESSED: 2, FAILED: 1 } },
      reconciliation: { runQueueRepairs: 1, billingRepairs24h: 2 },
      usage: { RUN_ADMITTED: 3, ATTEMPT_STARTED: 4, BROWSER_STEP: 5 },
      processCounters: [],
      heartbeats: {
        scheduler: null,
        'notification-worker': null,
        'webhook-worker': null,
      },
      incidents: [],
    } as unknown as OperationsSnapshot;
    const text = renderPrometheus(snapshotPrometheusSamples(snapshot));
    expect(text).toContain('runs_admitted_total 30');
    expect(text).toContain('runs_started_total 26');
    expect(text).toContain('run_recoveries_total 1');
    expect(text).toContain('queue_waiting{queue="browser"} 0');
    expect(text).toContain('browser_worker_instances{status="active"} 2');
    expect(text).toContain('schedule_occurrences_total{status="admitted"} 2');
    expect(text).toContain('notification_deliveries_total{status="sent"} 2');
    expect(text).toContain('webhook_deliveries_total{status="delivered"} 2');
    expect(text).toContain(
      'billing_webhook_events_total{status="processed"} 2'
    );
    expect(text).toContain(
      'reconciliation_repairs_total{subsystem="run_queue"} 1'
    );
    expect(text).toContain(
      'reconciliation_repairs_total{subsystem="billing"} 2'
    );
  });
});
