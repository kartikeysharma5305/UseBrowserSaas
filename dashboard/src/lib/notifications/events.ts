import type { NotificationType, Prisma, RunStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getPlan } from '@/lib/plans/catalogue';

import { emitNotification, createNotificationRecord } from './service';

const RUN_TYPE: Partial<Record<RunStatus, NotificationType>> = {
  SUCCESS: 'RUN_SUCCEEDED',
  FAILED: 'RUN_FAILED',
  TIMED_OUT: 'RUN_TIMED_OUT',
  CANCELED: 'RUN_CANCELED',
};

export async function createRunTerminalNotification(
  transaction: Prisma.TransactionClient,
  input: { userId: string; runId: string; status: RunStatus; recordedAt: Date }
) {
  const type = RUN_TYPE[input.status];
  if (!type) return null;
  const run = await transaction.run.findUnique({
    where: { id: input.runId },
    select: {
      lastFailureCode: true,
      agent: { select: { name: true } },
    },
  });
  if (!run) return null;
  return createNotificationRecord(transaction, {
    userId: input.userId,
    type,
    idempotencyKey: `run:${input.runId}:terminal:${input.status}`,
    runId: input.runId,
    payload: {
      agentName: run.agent.name,
      status: input.status,
      errorCategory: run.lastFailureCode ?? null,
      completedAt: input.recordedAt.toISOString(),
      actionPath: `/dashboard/runs/${input.runId}`,
    },
  });
}

export async function createUsageThresholdNotifications(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    metric: 'runs' | 'storage';
    periodStart: Date;
    periodEnd: Date;
  }
) {
  const user = await transaction.user.findUnique({
    where: { id: input.userId },
    select: { planCode: true },
  });
  if (!user) return;
  const plan = getPlan(user.planCode);
  const used =
    input.metric === 'runs'
      ? ((
          await transaction.usageRecord.aggregate({
            where: {
              userId: input.userId,
              periodStart: input.periodStart,
              type: 'RUN_ADMITTED',
            },
            _sum: { quantity: true },
          })
        )._sum.quantity ?? 0n)
      : BigInt(
          (
            await transaction.runArtifact.aggregate({
              where: { run: { agent: { userId: input.userId } } },
              _sum: { size: true },
            })
          )._sum.size ?? 0
        );
  const limit =
    input.metric === 'runs'
      ? BigInt(plan.limits.runsPerMonth)
      : plan.limits.artifactStorageBytes;
  if (limit <= 0n) return;
  const percentage = Number((used * 100n) / limit);
  for (const threshold of [80, 95, 100]) {
    if (percentage < threshold) continue;
    await createNotificationRecord(transaction, {
      userId: input.userId,
      type: input.metric === 'runs' ? 'USAGE_THRESHOLD' : 'STORAGE_THRESHOLD',
      idempotencyKey: `${input.metric}:${input.userId}:${input.periodStart.toISOString()}:${threshold}`,
      payload: {
        metric: input.metric,
        threshold,
        periodEnd: input.periodEnd.toISOString(),
        actionPath: '/dashboard/usage',
      },
    });
  }
}

export async function emitScheduleAlert(input: {
  scheduleId: string;
  occurrenceId: string;
  status: 'QUOTA_BLOCKED' | 'PLAN_BLOCKED' | 'ACTIVE_LIMIT_BLOCKED' | 'FAILED';
  occurredAt: Date;
}) {
  const schedule = await prisma.schedule.findUnique({
    where: { id: input.scheduleId },
    select: { userId: true, agent: { select: { name: true } } },
  });
  if (!schedule) return null;
  const day = input.occurredAt.toISOString().slice(0, 10);
  return emitNotification({
    userId: schedule.userId,
    type:
      input.status === 'FAILED' || input.status === 'ACTIVE_LIMIT_BLOCKED'
        ? 'SCHEDULE_REPEATED_FAILURE'
        : 'SCHEDULE_QUOTA_BLOCKED',
    idempotencyKey: `schedule:${input.scheduleId}:${input.status}:${day}`,
    scheduleId: input.scheduleId,
    payload: {
      agentName: schedule.agent.name,
      reason: input.status,
      occurredAt: input.occurredAt.toISOString(),
      actionPath: '/dashboard/schedules',
    },
  });
}

export async function emitBillingAlerts(input: {
  stripeSubscriptionId: string;
  eventType: string;
  eventId: string;
}) {
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: input.stripeSubscriptionId },
    select: {
      id: true,
      userId: true,
      status: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      user: { select: { planSource: true } },
    },
  });
  if (!subscription || subscription.user.planSource === 'INTERNAL') return;
  if (input.eventType === 'invoice.payment_failed') {
    await emitNotification({
      userId: subscription.userId,
      type: 'BILLING_PAYMENT_ISSUE',
      idempotencyKey: `billing:${input.eventId}:payment-issue`,
      subscriptionId: subscription.id,
      payload: { actionPath: '/dashboard/billing' },
    });
  }
  if (subscription.cancelAtPeriodEnd) {
    await emitNotification({
      userId: subscription.userId,
      type: 'SUBSCRIPTION_CANCELING',
      idempotencyKey: `billing:${input.eventId}:canceling`,
      subscriptionId: subscription.id,
      payload: {
        periodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        actionPath: '/dashboard/billing',
      },
    });
  }
  if (
    ['CANCELED', 'UNPAID', 'INCOMPLETE_EXPIRED'].includes(subscription.status)
  ) {
    await emitNotification({
      userId: subscription.userId,
      type: 'SUBSCRIPTION_ENDED',
      idempotencyKey: `billing:${input.eventId}:ended`,
      subscriptionId: subscription.id,
      payload: {
        status: subscription.status,
        actionPath: '/dashboard/billing',
      },
    });
  }
}
