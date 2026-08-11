import type {
  BillingWebhookProcessingState,
  NotificationDeliveryStatus,
  RunStatus,
  ScheduledOccurrenceStatus,
  UsageType,
  WebhookDeliveryStatus,
  WorkerInstanceStatus,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getNotificationDeliveryQueue } from '@/lib/notifications/queue';
import { readOperationalHeartbeats } from '@/lib/operations/heartbeats';
import {
  counterPrometheusSamples,
  type PrometheusSample,
} from '@/lib/operations/metrics';
import { getBrowserRunQueue } from '@/lib/queue/browser-run-queue';
import { getOutboundWebhookQueue } from '@/lib/webhooks/queue';

const WINDOW_MS = 24 * 60 * 60 * 1_000;
const CACHE_MS = 5_000;

export interface QueueSnapshot {
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: number;
}

export interface OperationsSnapshot {
  generatedAt: string;
  window: '24h';
  severity: 'OK' | 'DEGRADED' | 'CRITICAL';
  runs: {
    active: number;
    queued: number;
    outcomes: Record<string, number>;
    totals: Record<string, number>;
    admittedTotal: number;
    startedTotal: number;
    retryTotal: number;
    retries: number;
    recoveries: number;
    averageDurationMs: number;
    averageQueueWaitMs: number;
    oldestQueueWaitMs: number;
  };
  queues: Record<'browser' | 'notifications' | 'webhooks', QueueSnapshot>;
  workers: {
    statuses: Record<string, number>;
    configuredCapacity: number;
    activeExecutions: number;
    oldestHeartbeatAgeMs: number | null;
  };
  scheduler: {
    occurrences: Record<string, number>;
    lastHeartbeatAt: string | null;
  };
  notifications: {
    statuses: Record<string, number>;
    averageDeliveryMs: number;
    retrying: number;
  };
  webhooks: {
    statuses: Record<string, number>;
    averageDeliveryMs: number;
    retrying: number;
    rateLimited: number;
    disabledEndpoints: number;
  };
  billing: { webhookStatuses: Record<string, number> };
  reconciliation: { runQueueRepairs: number; billingRepairs24h: number };
  usage: Record<string, number>;
  processCounters: ReturnType<typeof counterPrometheusSamples>;
  heartbeats: Awaited<ReturnType<typeof readOperationalHeartbeats>>;
  incidents: Array<{
    timestamp: string;
    subsystem: 'run' | 'notification' | 'webhook' | 'billing';
    status: string;
    code: string;
    runId?: string;
    attempt?: number;
  }>;
}

let cached:
  | { expiresAt: number; value: Promise<OperationsSnapshot> }
  | undefined;

export function statusCounts<T extends string>(
  rows: Array<{ status: T; _count: { _all: number } }>
) {
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

export async function safeQueueSnapshot(queue: {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}): Promise<QueueSnapshot> {
  try {
    const value = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'paused'
    );
    return {
      available: true,
      waiting: value.waiting ?? 0,
      active: value.active ?? 0,
      delayed: value.delayed ?? 0,
      failed: value.failed ?? 0,
      paused: value.paused ?? 0,
    };
  } catch {
    return {
      available: false,
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
    };
  }
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length
  );
}

export function summarizeRuns(
  rows: Array<{
    status: string;
    queuedAt: Date | null;
    startedAt: Date;
    duration: number | null;
    attempt: number;
  }>,
  now: Date
) {
  const queueWaits = rows
    .filter((run) => run.queuedAt)
    .map((run) =>
      Math.max(0, run.startedAt.getTime() - run.queuedAt!.getTime())
    );
  const pendingWaits = rows
    .filter((run) => run.status === 'QUEUED' && run.queuedAt)
    .map((run) => Math.max(0, now.getTime() - run.queuedAt!.getTime()));
  return {
    outcomes: Object.fromEntries(
      ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].map((status) => [
        status,
        rows.filter((run) => run.status === status).length,
      ])
    ),
    retries: rows.reduce((sum, run) => sum + Math.max(0, run.attempt - 1), 0),
    averageDurationMs: average(
      rows.flatMap((run) => (run.duration === null ? [] : [run.duration]))
    ),
    averageQueueWaitMs: average(queueWaits),
    oldestQueueWaitMs: Math.max(0, ...pendingWaits),
  };
}

export function summarizeWorkers(
  rows: Array<{
    status: string;
    concurrency: number;
    activeCount: number;
    lastHeartbeatAt: Date;
  }>,
  now: Date
) {
  const statuses = Object.fromEntries(
    ['STARTING', 'ACTIVE', 'DRAINING', 'LOST'].map((status) => [
      status,
      rows.filter((worker) => worker.status === status).length,
    ])
  );
  return {
    statuses,
    configuredCapacity: rows
      .filter((worker) => worker.status === 'ACTIVE')
      .reduce((sum, worker) => sum + worker.concurrency, 0),
    activeExecutions: rows.reduce((sum, worker) => sum + worker.activeCount, 0),
    oldestHeartbeatAgeMs: rows.length
      ? Math.max(
          ...rows.map((worker) =>
            Math.max(0, now.getTime() - worker.lastHeartbeatAt.getTime())
          )
        )
      : null,
  };
}

function metricQuantity(value: bigint | null | undefined) {
  const number = Number(value ?? 0n);
  return Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER;
}

export function operationalSeverity(input: {
  activeWorkers: number;
  queueAvailable: boolean;
  waiting: number;
  oldestQueueWaitMs: number;
  failedRuns: number;
  completedRuns: number;
  schedulerHeartbeatAt: string | null;
  now?: Date;
}) {
  if (!input.queueAvailable || (input.waiting > 0 && input.activeWorkers === 0))
    return 'CRITICAL' as const;
  const total = input.failedRuns + input.completedRuns;
  const failureRate = total ? input.failedRuns / total : 0;
  const schedulerAge = input.schedulerHeartbeatAt
    ? (input.now ?? new Date()).getTime() -
      new Date(input.schedulerHeartbeatAt).getTime()
    : null;
  if (
    input.oldestQueueWaitMs > 60_000 ||
    failureRate > 0.25 ||
    (schedulerAge !== null && schedulerAge > 60_000)
  )
    return 'DEGRADED' as const;
  return 'OK' as const;
}

async function collect(now: Date): Promise<OperationsSnapshot> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [
    runRows,
    activeRuns,
    queuedRuns,
    admittedTotal,
    startedTotal,
    attemptAggregate,
    runStatusRows,
    workerRows,
    occurrenceRows,
    notificationRows,
    notificationRecent,
    webhookRows,
    webhookRecent,
    disabledEndpoints,
    billingRows,
    billingRecent,
    recoveryCount,
    billingRepairCount,
    usageRows,
    queues,
    heartbeats,
  ] = await Promise.all([
    prisma.run.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        status: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        duration: true,
        attempt: true,
        lastFailureCode: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5_000,
    }),
    prisma.run.count({ where: { status: 'RUNNING' } }),
    prisma.run.count({ where: { status: 'QUEUED' } }),
    prisma.run.count(),
    prisma.run.count({ where: { attempt: { gt: 0 } } }),
    prisma.run.aggregate({ _sum: { attempt: true } }),
    prisma.run.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.workerInstance.findMany({
      where: { status: { in: ['STARTING', 'ACTIVE', 'DRAINING', 'LOST'] } },
      select: {
        status: true,
        concurrency: true,
        activeCount: true,
        lastHeartbeatAt: true,
      },
      take: 1_000,
    }),
    prisma.scheduledOccurrence.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.notificationDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.notificationDelivery.findMany({
      where: { createdAt: { gte: since } },
      select: {
        status: true,
        attemptCount: true,
        createdAt: true,
        sentAt: true,
        updatedAt: true,
        failureCode: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 2_000,
    }),
    prisma.webhookDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.webhookDelivery.findMany({
      where: { createdAt: { gte: since } },
      select: {
        status: true,
        attemptCount: true,
        durationMs: true,
        httpStatus: true,
        failureCode: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 2_000,
    }),
    prisma.webhookEndpoint.count({ where: { status: 'DISABLED' } }),
    prisma.billingWebhookEvent.groupBy({
      by: ['processingState'],
      _count: { _all: true },
    }),
    prisma.billingWebhookEvent.findMany({
      where: { receivedAt: { gte: since }, processingState: 'FAILED' },
      select: { processedAt: true, receivedAt: true, errorCode: true },
      orderBy: { receivedAt: 'desc' },
      take: 10,
    }),
    prisma.agentEvent.count({
      where: {
        message: 'An expired worker lease was recovered and requeued.',
      },
    }),
    prisma.subscription.count({
      where: {
        lastStripeEventId: { startsWith: 'reconcile:' },
        lastStripeEventCreatedAt: { gte: since },
      },
    }),
    prisma.usageRecord.groupBy({
      by: ['type'],
      where: { recordedAt: { gte: since } },
      _sum: { quantity: true },
    }),
    Promise.all([
      safeQueueSnapshot(getBrowserRunQueue()),
      safeQueueSnapshot(getNotificationDeliveryQueue()),
      safeQueueSnapshot(getOutboundWebhookQueue()),
    ]),
    readOperationalHeartbeats(),
  ]);

  const runSummary = summarizeRuns(runRows, now);
  const workerSummary = summarizeWorkers(workerRows, now);
  const activeWorkers = workerSummary.statuses.ACTIVE ?? 0;
  const notificationLatency = notificationRecent
    .filter((delivery) => delivery.sentAt)
    .map(
      (delivery) => delivery.sentAt!.getTime() - delivery.createdAt.getTime()
    );
  const incidents: OperationsSnapshot['incidents'] = [
    ...runRows
      .filter((run) => ['FAILED', 'TIMED_OUT'].includes(run.status))
      .slice(0, 10)
      .map((run) => ({
        timestamp: (run.completedAt ?? run.startedAt).toISOString(),
        subsystem: 'run' as const,
        status: run.status,
        code: run.lastFailureCode ?? run.status,
        runId: run.id,
        attempt: run.attempt,
      })),
    ...notificationRecent
      .filter((delivery) => delivery.status === 'FAILED')
      .slice(0, 5)
      .map((delivery) => ({
        timestamp: delivery.updatedAt.toISOString(),
        subsystem: 'notification' as const,
        status: delivery.status,
        code: delivery.failureCode ?? 'DELIVERY_FAILED',
      })),
    ...webhookRecent
      .filter((delivery) => delivery.status === 'FAILED')
      .slice(0, 5)
      .map((delivery) => ({
        timestamp: delivery.updatedAt.toISOString(),
        subsystem: 'webhook' as const,
        status: delivery.status,
        code: delivery.failureCode ?? 'DELIVERY_FAILED',
      })),
    ...billingRecent.map((event) => ({
      timestamp: (event.processedAt ?? event.receivedAt).toISOString(),
      subsystem: 'billing' as const,
      status: 'FAILED',
      code: event.errorCode ?? 'WEBHOOK_PROCESSING_FAILED',
    })),
  ]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 20);
  const browserQueue = queues[0];
  return {
    generatedAt: now.toISOString(),
    window: '24h',
    severity: operationalSeverity({
      activeWorkers,
      queueAvailable: browserQueue.available,
      waiting: browserQueue.waiting,
      oldestQueueWaitMs: runSummary.oldestQueueWaitMs,
      failedRuns:
        (runSummary.outcomes.FAILED ?? 0) +
        (runSummary.outcomes.TIMED_OUT ?? 0),
      completedRuns: runSummary.outcomes.SUCCESS ?? 0,
      schedulerHeartbeatAt: heartbeats.scheduler,
      now,
    }),
    runs: {
      active: activeRuns,
      queued: queuedRuns,
      ...runSummary,
      totals: Object.fromEntries(
        runStatusRows.map((row) => [row.status, row._count._all])
      ) as Record<RunStatus, number>,
      admittedTotal,
      startedTotal,
      retryTotal: Math.max(
        0,
        (attemptAggregate._sum.attempt ?? 0) - startedTotal
      ),
      recoveries: recoveryCount,
    },
    queues: {
      browser: browserQueue,
      notifications: queues[1],
      webhooks: queues[2],
    },
    workers: {
      ...workerSummary,
    },
    scheduler: {
      occurrences: statusCounts<ScheduledOccurrenceStatus>(occurrenceRows),
      lastHeartbeatAt: heartbeats.scheduler,
    },
    notifications: {
      statuses: statusCounts<NotificationDeliveryStatus>(notificationRows),
      averageDeliveryMs: average(notificationLatency),
      retrying: notificationRecent.filter(
        (delivery) => delivery.status === 'PENDING' && delivery.attemptCount > 0
      ).length,
    },
    webhooks: {
      statuses: statusCounts<WebhookDeliveryStatus>(webhookRows),
      averageDeliveryMs: average(
        webhookRecent.flatMap((delivery) =>
          delivery.durationMs === null ? [] : [delivery.durationMs]
        )
      ),
      retrying: webhookRecent.filter(
        (delivery) => delivery.status === 'PENDING' && delivery.attemptCount > 0
      ).length,
      rateLimited: webhookRecent.filter(
        (delivery) => delivery.httpStatus === 429
      ).length,
      disabledEndpoints,
    },
    billing: {
      webhookStatuses: Object.fromEntries(
        billingRows.map((row) => [row.processingState, row._count._all])
      ) as Record<BillingWebhookProcessingState, number>,
    },
    reconciliation: {
      runQueueRepairs: recoveryCount,
      billingRepairs24h: billingRepairCount,
    },
    usage: Object.fromEntries(
      usageRows.map((row) => [row.type, metricQuantity(row._sum.quantity)])
    ) as Record<UsageType, number>,
    processCounters: counterPrometheusSamples(),
    heartbeats,
    incidents,
  };
}

export async function collectOperationsSnapshot(now = new Date()) {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = collect(now).catch((error) => {
    cached = undefined;
    throw error;
  });
  cached = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

export function resetOperationsSnapshotCacheForTests() {
  cached = undefined;
}

export function snapshotPrometheusSamples(snapshot: OperationsSnapshot) {
  const samples: PrometheusSample[] = [...snapshot.processCounters];
  for (const [status, value] of Object.entries(snapshot.runs.totals))
    samples.push({
      name: 'runs_completed_total',
      value,
      labels: { status: status.toLowerCase() },
      type: 'counter',
      help: 'Authoritative Runs by current terminal status.',
    });
  samples.push(
    { name: 'current_active_runs', value: snapshot.runs.active },
    { name: 'current_queued_runs', value: snapshot.runs.queued },
    { name: 'runs_admitted_total', value: snapshot.runs.admittedTotal },
    { name: 'runs_started_total', value: snapshot.runs.startedTotal },
    { name: 'run_retries_total', value: snapshot.runs.retryTotal },
    { name: 'run_recoveries_total', value: snapshot.runs.recoveries },
    {
      name: 'run_execution_duration_ms',
      value: snapshot.runs.averageDurationMs,
    },
    { name: 'queue_wait_duration_ms', value: snapshot.runs.averageQueueWaitMs }
  );
  samples.push({
    name: 'oldest_queue_wait_ms',
    value: snapshot.runs.oldestQueueWaitMs,
  });
  for (const [queueName, queue] of Object.entries(snapshot.queues))
    for (const field of [
      'waiting',
      'active',
      'delayed',
      'failed',
      'paused',
    ] as const)
      samples.push({
        name: `queue_${field}`,
        value: queue[field],
        labels: { queue: queueName },
      });
  for (const [status, value] of Object.entries(snapshot.workers.statuses))
    samples.push({
      name: 'browser_worker_instances',
      value,
      labels: { status: status.toLowerCase() },
    });
  samples.push(
    {
      name: 'browser_worker_capacity',
      value: snapshot.workers.configuredCapacity,
    },
    {
      name: 'browser_worker_active_executions',
      value: snapshot.workers.activeExecutions,
    }
  );
  for (const [status, value] of Object.entries(snapshot.scheduler.occurrences))
    samples.push({
      name: 'schedule_occurrences_total',
      value,
      labels: { status: status.toLowerCase() },
      type: 'counter',
    });
  for (const [status, value] of Object.entries(snapshot.notifications.statuses))
    samples.push({
      name: 'notification_deliveries_total',
      value,
      labels: { status: status.toLowerCase() },
      type: 'counter',
    });
  samples.push({
    name: 'notification_delivery_duration_ms',
    value: snapshot.notifications.averageDeliveryMs,
  });
  for (const [status, value] of Object.entries(snapshot.webhooks.statuses))
    samples.push({
      name: 'webhook_deliveries_total',
      value,
      labels: { status: status.toLowerCase() },
      type: 'counter',
    });
  samples.push({
    name: 'webhook_delivery_duration_ms',
    value: snapshot.webhooks.averageDeliveryMs,
  });
  for (const [status, value] of Object.entries(
    snapshot.billing.webhookStatuses
  ))
    samples.push({
      name: 'billing_webhook_events_total',
      value,
      labels: { status: status.toLowerCase() },
      type: 'counter',
    });
  samples.push(
    {
      name: 'reconciliation_repairs_total',
      value: snapshot.reconciliation.runQueueRepairs,
      labels: { subsystem: 'run_queue' },
      type: 'counter',
    },
    {
      name: 'reconciliation_repairs_total',
      value: snapshot.reconciliation.billingRepairs24h,
      labels: { subsystem: 'billing' },
      type: 'counter',
    }
  );
  for (const [type, value] of Object.entries(snapshot.usage))
    samples.push({
      name: 'usage_quantity_24h',
      value,
      labels: { type: type.toLowerCase() },
    });
  const generatedAt = Date.parse(snapshot.generatedAt);
  for (const [component, heartbeatAt] of Object.entries(snapshot.heartbeats)) {
    if (!heartbeatAt) continue;
    samples.push({
      name: 'process_heartbeat_age_ms',
      value: Math.max(0, generatedAt - Date.parse(heartbeatAt)),
      labels: { component },
    });
  }
  return samples;
}
