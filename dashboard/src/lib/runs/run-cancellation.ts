import { AgentEventType, RunStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { isTerminalRunStatus } from '@/lib/execution/run-state';
import { logger } from '@/lib/logger';
import { getBrowserRunQueue } from '@/lib/queue/browser-run-queue';
import { publishRunNotification } from '@/lib/realtime/run-notifications';
import { recordTerminalUsage } from '@/lib/usage/ledger';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';

import {
  sanitizeCancellationReason,
  type RunCancellationResult,
} from './cancellation-types';

export class RunNotFoundError extends Error {
  constructor() {
    super('Run not found.');
    this.name = 'RunNotFoundError';
  }
}

class RunCancellationRaceError extends Error {}

async function removeQueuedJob(runId: string): Promise<void> {
  try {
    const job = await getBrowserRunQueue().getJob(runId);
    if (job) await job.remove();
  } catch (error) {
    // PostgreSQL already makes the canceled job unclaimable.
    logger.warn('Canceled queue job could not be removed immediately', {
      runId,
      error: safeSerializeError(error),
    });
  }
}

async function cancelInTransaction(
  runId: string,
  userId: string,
  reason: string | null
): Promise<RunCancellationResult> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
    `;
    const run = await transaction.run.findFirst({
      where: { id: runId, agent: { userId } },
      select: {
        id: true,
        status: true,
        startedAt: true,
        cancelRequestedAt: true,
      },
    });
    if (!run) throw new RunNotFoundError();

    if (isTerminalRunStatus(run.status)) {
      return {
        runId,
        status: run.status,
        cancelRequested: run.status === RunStatus.CANCELED,
        alreadyTerminal: true,
      };
    }

    if (run.cancelRequestedAt) {
      return {
        runId,
        status: run.status,
        cancelRequested: true,
        alreadyTerminal: false,
      };
    }

    const now = new Date();
    const maximum = await transaction.agentEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    const sequence = (maximum._max.sequence ?? 0) + 1;

    if (run.status === RunStatus.QUEUED) {
      const updated = await transaction.run.updateMany({
        where: {
          id: runId,
          status: RunStatus.QUEUED,
          cancelRequestedAt: null,
        },
        data: {
          status: RunStatus.CANCELED,
          cancelRequestedAt: now,
          canceledAt: now,
          canceledByUserId: userId,
          cancelReason: reason,
          completedAt: now,
          duration: 0,
          errorMessage: null,
          queueJobId: null,
          workerId: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
          lastFailureCode: null,
        },
      });
      if (updated.count !== 1) throw new RunCancellationRaceError();
      await transaction.agentEvent.create({
        data: {
          runId,
          sequence,
          type: AgentEventType.RUN_CANCELED,
          message: 'Run canceled before execution started.',
          data: { status: 'CANCELED' },
          timestamp: now,
        },
      });
      await recordTerminalUsage(transaction, {
        userId,
        runId,
        status: RunStatus.CANCELED,
        attempt: 0,
        durationMs: 0,
        recordedAt: now,
      });
      return {
        runId,
        status: 'CANCELED',
        cancelRequested: true,
        alreadyTerminal: false,
      };
    }

    const updated = await transaction.run.updateMany({
      where: {
        id: runId,
        status: RunStatus.RUNNING,
        cancelRequestedAt: null,
      },
      data: {
        cancelRequestedAt: now,
        canceledByUserId: userId,
        cancelReason: reason,
      },
    });
    if (updated.count !== 1) throw new RunCancellationRaceError();
    await transaction.agentEvent.create({
      data: {
        runId,
        sequence,
        type: AgentEventType.SYSTEM,
        message: 'Cancellation requested.',
        data: { status: 'RUNNING', cancellationRequested: true },
        timestamp: now,
      },
    });
    return {
      runId,
      status: 'RUNNING',
      cancelRequested: true,
      alreadyTerminal: false,
    };
  });
}

export async function cancelOwnedRun(
  runId: string,
  userId: string,
  reason?: string
): Promise<RunCancellationResult> {
  const safeReason = reason ? sanitizeCancellationReason(reason) || null : null;
  let result: RunCancellationResult;
  try {
    result = await cancelInTransaction(runId, userId, safeReason);
  } catch (error) {
    if (!(error instanceof RunCancellationRaceError)) throw error;
    result = await cancelInTransaction(runId, userId, safeReason);
  }

  if (result.status === 'CANCELED' && !result.alreadyTerminal) {
    await removeQueuedJob(runId);
  }
  if (result.cancelRequested) {
    await publishRunNotification(
      runId,
      result.status === 'RUNNING' ? 'cancel' : 'changed'
    );
  }
  if (result.status === 'CANCELED' && !result.alreadyTerminal)
    await enqueuePendingNotificationDeliveries().catch(() => undefined);
  if (result.status === 'CANCELED' && !result.alreadyTerminal)
    await enqueuePendingWebhookDeliveries().catch(() => undefined);
  return result;
}
