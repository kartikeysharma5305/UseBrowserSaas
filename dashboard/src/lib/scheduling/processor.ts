import type { Prisma, ScheduledOccurrenceStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { ExecutionServiceError } from '@/lib/execution/errors';
import { PrismaRunProducer } from '@/lib/queue/run-producer';
import { getSchedulingEntitlement } from './entitlement';
import { nextOccurrenceAfter, occurrenceAtOrBefore } from './recurrence';
import { SCHEDULER_POLICY } from './policy';
import { emitScheduleAlert } from '@/lib/notifications/events';
import { createScheduleWebhookEvent } from '@/lib/webhooks/events';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';

type SchedulerDatabase = typeof prisma;

async function advisoryLock(
  transaction: Prisma.TransactionClient,
  key: string
) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function recurrence(schedule: {
  kind: 'ONCE' | 'DAILY' | 'WEEKLY';
  timezone: string;
  localTime: string | null;
  weekdays: number[];
  oneTimeAt: Date | null;
}) {
  return {
    kind: schedule.kind,
    timezone: schedule.timezone,
    localTime: schedule.localTime,
    weekdays: schedule.weekdays,
    oneTimeAt: schedule.oneTimeAt,
  };
}

export async function discoverDueSchedule(
  scheduleId: string,
  now = new Date(),
  database: SchedulerDatabase = prisma
) {
  const result = await database.$transaction(async (transaction) => {
    await advisoryLock(transaction, `schedule:${scheduleId}`);
    const schedule = await transaction.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        agent: { select: { status: true } },
        user: {
          select: {
            planCode: true,
            accountDeletion: { select: { status: true } },
          },
        },
      },
    });
    if (
      !schedule ||
      schedule.state !== 'ENABLED' ||
      !schedule.nextRunAt ||
      schedule.nextRunAt > now
    )
      return null;
    await advisoryLock(transaction, `agent:${schedule.agentId}`);

    const rule = recurrence(schedule);
    const originalDue = schedule.nextRunAt;
    const lookbackStart = new Date(
      now.getTime() - SCHEDULER_POLICY.recurringLookbackMs
    );

    if (
      schedule.kind === 'ONCE' &&
      originalDue.getTime() < now.getTime() - SCHEDULER_POLICY.oneTimeGraceMs
    ) {
      await transaction.scheduledOccurrence.upsert({
        where: {
          scheduleId_scheduledFor: { scheduleId, scheduledFor: originalDue },
        },
        create: {
          scheduleId,
          scheduledFor: originalDue,
          status: 'MISSED',
          resolvedAt: now,
        },
        update: {},
      });
      await transaction.schedule.update({
        where: { id: scheduleId },
        data: {
          state: 'COMPLETED',
          nextRunAt: null,
          lastTriggeredOccurrenceAt: originalDue,
          version: { increment: 1 },
        },
      });
      return null;
    }

    let selected = originalDue;
    if (schedule.kind !== 'ONCE') {
      const start = originalDue < lookbackStart ? lookbackStart : originalDue;
      selected = occurrenceAtOrBefore(rule, start, now) ?? originalDue;
      if (
        originalDue < lookbackStart ||
        selected.getTime() !== originalDue.getTime()
      ) {
        await transaction.scheduledOccurrence.upsert({
          where: {
            scheduleId_scheduledFor: { scheduleId, scheduledFor: originalDue },
          },
          create: {
            scheduleId,
            scheduledFor: originalDue,
            status: 'MISSED',
            resolvedAt: now,
          },
          update: {},
        });
      }
      if (selected < lookbackStart) {
        const nextFuture = nextOccurrenceAfter(rule, now);
        await transaction.schedule.update({
          where: { id: scheduleId },
          data: { nextRunAt: nextFuture, version: { increment: 1 } },
        });
        return null;
      }
    }

    let status: ScheduledOccurrenceStatus = 'DISCOVERED';
    if (
      schedule.user.accountDeletion?.status === 'PENDING' ||
      schedule.user.accountDeletion?.status === 'FAILED'
    )
      status = 'ACCOUNT_BLOCKED';
    else if (!getSchedulingEntitlement(schedule.user.planCode).enabled)
      status = 'PLAN_BLOCKED';
    else if (
      schedule.agent.status !== 'ACTIVE' ||
      schedule.configurationErrorCode
    )
      status = 'AGENT_BLOCKED';

    const occurrence = await transaction.scheduledOccurrence.upsert({
      where: {
        scheduleId_scheduledFor: { scheduleId, scheduledFor: selected },
      },
      create: {
        scheduleId,
        scheduledFor: selected,
        status,
        ...(status === 'DISCOVERED'
          ? {}
          : {
              resolvedAt: now,
              errorCode: schedule.configurationErrorCode ?? status,
            }),
      },
      update: {},
    });
    const nextRunAt =
      schedule.kind === 'ONCE' ? null : nextOccurrenceAfter(rule, selected);
    await transaction.schedule.update({
      where: { id: scheduleId },
      data: {
        nextRunAt,
        lastTriggeredOccurrenceAt: selected,
        state: schedule.kind === 'ONCE' ? 'COMPLETED' : schedule.state,
        version: { increment: 1 },
        ...(status === 'DISCOVERED'
          ? {}
          : { consecutiveBlocks: { increment: 1 } }),
      },
    });
    return occurrence.status === 'DISCOVERED' ? occurrence : null;
  });
  if (database === prisma && !result) {
    const blocked = await prisma.scheduledOccurrence.findFirst({
      where: {
        scheduleId,
        status: {
          in: [
            'PLAN_BLOCKED',
            'QUOTA_BLOCKED',
            'ACCOUNT_BLOCKED',
            'AGENT_BLOCKED',
          ],
        },
        resolvedAt: { gte: new Date(now.getTime() - 60_000) },
      },
      orderBy: { scheduledFor: 'desc' },
      select: {
        id: true,
        status: true,
        schedule: { select: { userId: true } },
      },
    });
    if (blocked) {
      await prisma.$transaction((transaction) =>
        createScheduleWebhookEvent(transaction, {
          userId: blocked.schedule.userId,
          scheduleId,
          occurrenceId: blocked.id,
          status: blocked.status,
          recordedAt: now,
        })
      );
      await enqueuePendingWebhookDeliveries().catch(() => undefined);
    }
    if (
      blocked &&
      (blocked.status === 'PLAN_BLOCKED' || blocked.status === 'QUOTA_BLOCKED')
    )
      await emitScheduleAlert({
        scheduleId,
        occurrenceId: blocked.id,
        status: blocked.status as 'PLAN_BLOCKED' | 'QUOTA_BLOCKED',
        occurredAt: now,
      }).catch(() => undefined);
  }
  return result;
}

function terminalStatus(
  error: ExecutionServiceError
): ScheduledOccurrenceStatus | null {
  if (
    error.code === 'MONTHLY_RUN_LIMIT_REACHED' ||
    error.code === 'MONTHLY_EXECUTION_LIMIT_REACHED' ||
    error.code === 'STORAGE_LIMIT_REACHED' ||
    error.code === 'MAX_RUN_DURATION_EXCEEDED' ||
    error.code === 'MAX_STEPS_EXCEEDED'
  )
    return 'QUOTA_BLOCKED';
  if (
    error.code === 'USER_RUN_LIMIT_REACHED' ||
    error.code === 'USER_QUEUE_LIMIT_REACHED' ||
    error.code === 'RUN_RATE_LIMITED' ||
    error.code === 'AGENT_RUN_ALREADY_ACTIVE'
  )
    return 'ACTIVE_LIMIT_BLOCKED';
  if (
    error.code === 'SCHEDULING_NOT_AVAILABLE' ||
    error.code === 'EXECUTION_DISABLED'
  )
    return 'PLAN_BLOCKED';
  if (error.code === 'ACCOUNT_DELETION_IN_PROGRESS') return 'ACCOUNT_BLOCKED';
  if (error.code === 'BETA_ACCESS_SUSPENDED') return 'ACCOUNT_BLOCKED';
  if (
    error.code === 'AGENT_NOT_FOUND' ||
    error.code === 'AGENT_SCHEDULING_DISABLED' ||
    error.code === 'INVALID_RUN_INPUT' ||
    error.code === 'SECRET_VARIABLES_UNAVAILABLE'
  )
    return 'AGENT_BLOCKED';
  return null;
}

export async function processDiscoveredOccurrence(
  occurrenceId: string,
  now = new Date(),
  database: SchedulerDatabase = prisma,
  producer = new PrismaRunProducer()
) {
  const leaseUntil = new Date(
    now.getTime() + SCHEDULER_POLICY.occurrenceLeaseMs
  );
  const claimed = await database.scheduledOccurrence.updateMany({
    where: {
      id: occurrenceId,
      status: 'DISCOVERED',
      nextAttemptAt: { lte: now },
      OR: [
        { processingLeaseUntil: null },
        { processingLeaseUntil: { lt: now } },
      ],
    },
    data: { processingLeaseUntil: leaseUntil, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return false;
  const occurrence = await database.scheduledOccurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      schedule: { select: { id: true, userId: true, agentId: true } },
    },
  });
  if (!occurrence) return false;
  try {
    await producer.enqueue({
      userId: occurrence.schedule.userId,
      agentId: occurrence.schedule.agentId,
      scheduled: {
        scheduleId: occurrence.schedule.id,
        occurrenceId: occurrence.id,
        scheduledFor: occurrence.scheduledFor,
      },
    });
    await database.schedule.updateMany({
      where: { id: occurrence.scheduleId },
      data: { consecutiveFailures: 0, consecutiveBlocks: 0 },
    });
    return true;
  } catch (error) {
    const current = await database.scheduledOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { status: true, attempts: true },
    });
    if (!current || current.status !== 'DISCOVERED') return false;
    const executionError =
      error instanceof ExecutionServiceError ? error : null;
    const terminal = executionError ? terminalStatus(executionError) : null;
    if (terminal) {
      await database.scheduledOccurrence.update({
        where: { id: occurrenceId },
        data: {
          status: terminal,
          resolvedAt: now,
          processingLeaseUntil: null,
          errorCode: executionError!.code,
        },
      });
      await database.schedule.updateMany({
        where: { id: occurrence.scheduleId },
        data: { consecutiveBlocks: { increment: 1 } },
      });
      if (database === prisma) {
        const schedule = await prisma.schedule.findUnique({
          where: { id: occurrence.scheduleId },
          select: { consecutiveBlocks: true },
        });
        if (
          terminal === 'QUOTA_BLOCKED' ||
          terminal === 'PLAN_BLOCKED' ||
          (terminal === 'ACTIVE_LIMIT_BLOCKED' &&
            (schedule?.consecutiveBlocks ?? 0) >= 3)
        )
          await emitScheduleAlert({
            scheduleId: occurrence.scheduleId,
            occurrenceId,
            status: terminal as
              | 'QUOTA_BLOCKED'
              | 'PLAN_BLOCKED'
              | 'ACTIVE_LIMIT_BLOCKED',
            occurredAt: now,
          }).catch(() => undefined);
        await prisma.$transaction((transaction) =>
          createScheduleWebhookEvent(transaction, {
            userId: occurrence.schedule.userId,
            scheduleId: occurrence.scheduleId,
            occurrenceId,
            status: terminal,
            recordedAt: now,
          })
        );
        await enqueuePendingWebhookDeliveries().catch(() => undefined);
      }
      return false;
    }
    const exhausted = current.attempts >= SCHEDULER_POLICY.maxAdmissionAttempts;
    await database.scheduledOccurrence.update({
      where: { id: occurrenceId },
      data: exhausted
        ? {
            status: 'FAILED',
            resolvedAt: now,
            processingLeaseUntil: null,
            errorCode: 'SCHEDULE_ADMISSION_FAILED',
          }
        : {
            processingLeaseUntil: null,
            nextAttemptAt: new Date(
              now.getTime() + SCHEDULER_POLICY.retryDelayMs
            ),
            errorCode: 'SCHEDULE_ADMISSION_RETRY',
          },
    });
    await database.schedule.updateMany({
      where: { id: occurrence.scheduleId },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (database === prisma && exhausted) {
      await emitScheduleAlert({
        scheduleId: occurrence.scheduleId,
        occurrenceId,
        status: 'FAILED',
        occurredAt: now,
      }).catch(() => undefined);
      await prisma.$transaction((transaction) =>
        createScheduleWebhookEvent(transaction, {
          userId: occurrence.schedule.userId,
          scheduleId: occurrence.scheduleId,
          occurrenceId,
          status: 'FAILED',
          recordedAt: now,
        })
      );
      await enqueuePendingWebhookDeliveries().catch(() => undefined);
    }
    return false;
  }
}

export async function runSchedulerTick(
  now = new Date(),
  database: SchedulerDatabase = prisma
) {
  const due = await database.schedule.findMany({
    where: { state: 'ENABLED', nextRunAt: { lte: now } },
    select: { id: true },
    orderBy: { nextRunAt: 'asc' },
    take: SCHEDULER_POLICY.batchSize,
  });
  let discoveryFailures = 0;
  for (const item of due) {
    try {
      await discoverDueSchedule(item.id, now, database);
    } catch {
      discoveryFailures += 1;
      await database.schedule
        .updateMany({
          where: { id: item.id },
          data: { consecutiveFailures: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }
  const retryable = await database.scheduledOccurrence.findMany({
    where: {
      status: 'DISCOVERED',
      nextAttemptAt: { lte: now },
      OR: [
        { processingLeaseUntil: null },
        { processingLeaseUntil: { lt: now } },
      ],
    },
    select: { id: true },
    orderBy: { scheduledFor: 'asc' },
    take: SCHEDULER_POLICY.batchSize,
  });
  let admitted = 0;
  for (const item of retryable)
    if (await processDiscoveredOccurrence(item.id, now, database))
      admitted += 1;
  return {
    due: due.length,
    processed: retryable.length,
    admitted,
    discoveryFailures,
  };
}
