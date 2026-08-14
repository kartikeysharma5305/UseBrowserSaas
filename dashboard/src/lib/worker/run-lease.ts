import {
  AgentEventType,
  Prisma,
  RunStatus,
  UsageMeasurement,
  UsageType,
  UsageUnit,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { publishRunNotification } from '@/lib/realtime/run-notifications';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import { createRunWebhookEvent } from '@/lib/webhooks/events';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';
import {
  recordAttemptDuration,
  recordTerminalUsage,
  recordUsage,
} from '@/lib/usage/ledger';

export interface ClaimedRun {
  id: string;
  agentId: string;
  startedAt: Date;
  attempt: number;
  eventStartSequence: number;
  executionTask: string | null;
  executionTargetWebsite: string | null;
  inputSnapshot: Prisma.JsonValue | null;
  executionConfiguration: unknown;
  costBudget: unknown;
  executionSafetyPolicy: unknown;
  agent: {
    userId: string;
    configuration: unknown;
  };
}

export async function claimRun(
  runId: string,
  workerId: string,
  leaseMs: number
): Promise<ClaimedRun | null> {
  const claimed = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
    `;
    const now = new Date();
    const updated = await transaction.run.updateMany({
      where: {
        id: runId,
        cancelRequestedAt: null,
        OR: [
          { status: RunStatus.QUEUED },
          {
            status: RunStatus.RUNNING,
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: RunStatus.RUNNING,
        startedAt: now,
        completedAt: null,
        duration: null,
        errorMessage: null,
        workerId,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        attempt: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;

    const run = await transaction.run.findUnique({
      where: { id: runId },
      include: {
        agent: {
          select: {
            userId: true,
            configuration: true,
          },
        },
      },
    });
    if (!run) return null;

    const maximum = await transaction.agentEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    const startedSequence = (maximum._max.sequence ?? 0) + 1;
    await transaction.agentEvent.create({
      data: {
        runId,
        sequence: startedSequence,
        type: AgentEventType.RUN_STARTED,
        message: 'Browser worker started execution.',
        data: { attempt: run.attempt },
      },
    });
    await recordUsage(transaction, {
      userId: run.agent.userId,
      runId,
      attempt: run.attempt,
      type: UsageType.ATTEMPT_STARTED,
      quantity: 1n,
      unit: UsageUnit.COUNT,
      measurement: UsageMeasurement.EXACT,
      idempotencyKey: `run:${runId}:attempt:${run.attempt}:started`,
      recordedAt: run.startedAt,
    });
    await createRunWebhookEvent(transaction, {
      userId: run.agent.userId,
      runId,
      status: RunStatus.RUNNING,
      recordedAt: now,
    });
    return { ...run, eventStartSequence: startedSequence + 1 };
  });
  if (claimed) {
    await publishRunNotification(runId);
    await enqueuePendingWebhookDeliveries().catch(() => undefined);
  }
  return claimed;
}

export async function heartbeatRun(
  runId: string,
  workerId: string,
  leaseMs: number
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.run.updateMany({
    where: { id: runId, status: RunStatus.RUNNING, workerId },
    data: {
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
  });
  return result.count === 1;
}

export async function recordClaimedRunModel(
  runId: string,
  workerId: string,
  sequence: number,
  attempt: number,
  model: string
): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const owned = await transaction.run.findFirst({
      where: { id: runId, status: RunStatus.RUNNING, workerId },
      select: { id: true },
    });
    if (!owned) return false;
    const updated = await transaction.agentEvent.updateMany({
      where: { runId, sequence, type: AgentEventType.RUN_STARTED },
      data: { data: { attempt, model } },
    });
    return updated.count === 1;
  });
}

export async function releaseRunForRetry(
  runId: string,
  workerId: string,
  code: string
): Promise<boolean> {
  const released = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
    `;
    const current = await transaction.run.findFirst({
      where: {
        id: runId,
        status: RunStatus.RUNNING,
        workerId,
        cancelRequestedAt: null,
      },
      select: {
        startedAt: true,
        attempt: true,
        agent: { select: { userId: true } },
      },
    });
    if (!current) return false;
    const now = new Date();
    const updated = await transaction.run.updateMany({
      where: {
        id: runId,
        status: RunStatus.RUNNING,
        workerId,
        cancelRequestedAt: null,
      },
      data: {
        status: RunStatus.QUEUED,
        queuedAt: now,
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        lastFailureCode: code,
      },
    });
    if (updated.count !== 1) return false;
    await recordAttemptDuration(transaction, {
      userId: current.agent.userId,
      runId,
      attempt: current.attempt,
      durationMs: Math.max(0, now.getTime() - current.startedAt.getTime()),
      recordedAt: now,
    });
    const maximum = await transaction.agentEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    await transaction.agentEvent.create({
      data: {
        runId,
        sequence: (maximum._max.sequence ?? 0) + 1,
        type: AgentEventType.SYSTEM,
        message: 'Execution attempt will be retried.',
        data: { code },
      },
    });
    return true;
  });
  if (released) await publishRunNotification(runId);
  return released;
}

export async function failClaimedRun(
  runId: string,
  workerId: string,
  code: string,
  message: string
): Promise<boolean> {
  const completedAt = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
    `;
    const current = await transaction.run.findFirst({
      where: {
        id: runId,
        status: RunStatus.RUNNING,
        workerId,
        cancelRequestedAt: null,
      },
      select: {
        startedAt: true,
        attempt: true,
        agent: { select: { userId: true } },
      },
    });
    if (!current) return false;
    const result = await transaction.run.updateMany({
      where: {
        id: runId,
        status: RunStatus.RUNNING,
        workerId,
        cancelRequestedAt: null,
      },
      data: {
        status: RunStatus.FAILED,
        completedAt,
        duration: Math.max(
          0,
          completedAt.getTime() - current.startedAt.getTime()
        ),
        errorMessage: message,
        lastFailureCode: code,
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
    if (result.count !== 1) return false;
    await recordTerminalUsage(transaction, {
      userId: current.agent.userId,
      runId,
      status: RunStatus.FAILED,
      attempt: current.attempt,
      durationMs: Math.max(
        0,
        completedAt.getTime() - current.startedAt.getTime()
      ),
      recordedAt: completedAt,
    });
    return true;
  });
  if (updated) {
    await publishRunNotification(runId);
    await enqueuePendingNotificationDeliveries().catch(() => undefined);
    await enqueuePendingWebhookDeliveries().catch(() => undefined);
  }
  return updated;
}
