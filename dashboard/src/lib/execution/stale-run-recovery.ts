import { AgentEventType, RunStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getStaleRunThresholdMs } from '@/lib/execution/configuration';
import { assertRunStatusTransition } from '@/lib/execution/run-state';
import { logger } from '@/lib/logger';
import { recordTerminalUsage } from '@/lib/usage/ledger';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';

export interface StaleRunRecoveryResult {
  inspected: number;
  recovered: number;
}

export async function recoverStaleRuns(
  options: {
    userId?: string;
    now?: Date;
    thresholdMs?: number;
    limit?: number;
  } = {}
): Promise<StaleRunRecoveryResult> {
  const now = options.now ?? new Date();
  const thresholdMs = options.thresholdMs ?? getStaleRunThresholdMs();
  const cutoff = new Date(now.getTime() - thresholdMs);
  const candidates = await prisma.run.findMany({
    where: {
      status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
      cancelRequestedAt: null,
      startedAt: { lt: cutoff },
      OR: [
        { status: RunStatus.QUEUED },
        {
          status: RunStatus.RUNNING,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
      ],
      ...(options.userId ? { agent: { userId: options.userId } } : {}),
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      agentId: true,
      attempt: true,
      agent: { select: { userId: true } },
    },
    orderBy: { startedAt: 'asc' },
    take: options.limit ?? 100,
  });

  let recovered = 0;
  for (const candidate of candidates) {
    const applied = await prisma.$transaction(async (transaction) => {
      assertRunStatusTransition(candidate.status, RunStatus.TIMED_OUT);
      const updated = await transaction.run.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          cancelRequestedAt: null,
        },
        data: {
          status: RunStatus.TIMED_OUT,
          completedAt: now,
          duration: Math.max(0, now.getTime() - candidate.startedAt.getTime()),
          errorMessage: 'The agent run exceeded its time limit.',
        },
      });
      if (updated.count !== 1) return false;

      const aggregate = await transaction.agentEvent.aggregate({
        where: { runId: candidate.id },
        _max: { sequence: true },
      });
      await transaction.agentEvent.create({
        data: {
          runId: candidate.id,
          sequence: (aggregate._max.sequence ?? 0) + 1,
          type: AgentEventType.RUN_FAILED,
          message: 'Stale active run recovered as timed out.',
          data: { success: false, status: 'TIMED_OUT', recovered: true },
          timestamp: now,
        },
      });
      await recordTerminalUsage(transaction, {
        userId: candidate.agent.userId,
        runId: candidate.id,
        status: RunStatus.TIMED_OUT,
        attempt: candidate.attempt,
        durationMs:
          candidate.attempt > 0
            ? Math.max(0, now.getTime() - candidate.startedAt.getTime())
            : 0,
        recordedAt: now,
      });
      return true;
    });

    if (applied) {
      recovered += 1;
      logger.info('Recovered stale run', {
        runId: candidate.id,
        agentId: candidate.agentId,
        status: 'TIMED_OUT',
      });
    }
  }

  if (recovered > 0)
    await enqueuePendingNotificationDeliveries().catch(() => undefined);
  if (recovered > 0)
    await enqueuePendingWebhookDeliveries().catch(() => undefined);
  return { inspected: candidates.length, recovered };
}
