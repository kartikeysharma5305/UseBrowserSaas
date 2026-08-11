import { Prisma, RunStatus } from '@prisma/client';

import { prisma } from '../src/lib/db/prisma';
import {
  createBrowserRunQueue,
  enqueueBrowserRun,
} from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';

const apply = process.argv.includes('--apply');
const configuration = getQueueConfiguration();
const queue = createBrowserRunQueue(configuration);
const report = {
  mode: apply ? 'apply' : 'dry-run',
  missingJobs: 0,
  expiredLeases: 0,
  exhaustedLeases: 0,
  terminalJobs: 0,
  orphanJobs: 0,
  canceledRequests: 0,
};

async function appendRecoveryEvent(
  transaction: Prisma.TransactionClient,
  runId: string,
  type: 'SYSTEM' | 'RUN_FAILED' | 'RUN_CANCELED',
  message: string,
  data: Record<string, string | boolean>
) {
  const maximum = await transaction.agentEvent.aggregate({
    where: { runId },
    _max: { sequence: true },
  });
  await transaction.agentEvent.create({
    data: {
      runId,
      sequence: (maximum._max.sequence ?? 0) + 1,
      type,
      message,
      data,
    },
  });
}

try {
  const activeRows = await prisma.run.findMany({
    where: { status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] } },
    select: {
      id: true,
      status: true,
      attempt: true,
      leaseExpiresAt: true,
      cancelRequestedAt: true,
      startedAt: true,
    },
  });
  const now = new Date();
  for (const run of activeRows) {
    if (run.cancelRequestedAt) {
      report.canceledRequests += 1;
      if (apply) {
        await prisma.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${run.id}, 0))
          `;
          const updated = await transaction.run.updateMany({
            where: {
              id: run.id,
              status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
              cancelRequestedAt: { not: null },
              OR: [
                { status: RunStatus.QUEUED },
                { leaseExpiresAt: { lt: now } },
              ],
            },
            data: {
              status: RunStatus.CANCELED,
              canceledAt: now,
              completedAt: now,
              duration: Math.max(0, now.getTime() - run.startedAt.getTime()),
              errorMessage: null,
              lastFailureCode: null,
              queueJobId: null,
              workerId: null,
              heartbeatAt: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count === 1) {
            await appendRecoveryEvent(
              transaction,
              run.id,
              'RUN_CANCELED',
              'Cancellation completed during queue recovery.',
              { status: 'CANCELED', recovered: true }
            );
          }
        });
        const canceledJob = await queue.getJob(run.id);
        if (canceledJob) await canceledJob.remove().catch(() => undefined);
      }
      continue;
    }

    if (
      run.status === RunStatus.RUNNING &&
      run.leaseExpiresAt &&
      run.leaseExpiresAt < now
    ) {
      report.expiredLeases += 1;
      if (run.attempt >= configuration.attempts) {
        report.exhaustedLeases += 1;
        if (apply) {
          await prisma.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              SELECT pg_advisory_xact_lock(hashtextextended(${run.id}, 0))
            `;
            const updated = await transaction.run.updateMany({
              where: {
                id: run.id,
                status: RunStatus.RUNNING,
                leaseExpiresAt: { lt: now },
                cancelRequestedAt: null,
              },
              data: {
                status: RunStatus.FAILED,
                completedAt: now,
                errorMessage:
                  'The agent run failed. Review the run details for more information.',
                lastFailureCode: 'EXECUTION_FAILED',
                workerId: null,
                heartbeatAt: null,
                leaseExpiresAt: null,
              },
            });
            if (updated.count === 1) {
              await appendRecoveryEvent(
                transaction,
                run.id,
                'RUN_FAILED',
                'The agent run failed after exhausting recovery attempts.',
                { code: 'EXECUTION_FAILED', success: false }
              );
            }
          });
        }
        continue;
      }
      if (apply) {
        await prisma.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${run.id}, 0))
          `;
          const updated = await transaction.run.updateMany({
            where: {
              id: run.id,
              status: RunStatus.RUNNING,
              leaseExpiresAt: { lt: now },
              cancelRequestedAt: null,
            },
            data: {
              status: RunStatus.QUEUED,
              queuedAt: now,
              workerId: null,
              heartbeatAt: null,
              leaseExpiresAt: null,
              lastFailureCode: 'WORKER_LEASE_EXPIRED',
            },
          });
          if (updated.count === 1) {
            await appendRecoveryEvent(
              transaction,
              run.id,
              'SYSTEM',
              'An expired worker lease was recovered and requeued.',
              { code: 'WORKER_LEASE_EXPIRED' }
            );
          }
        });
      }
    }

    if (
      run.status === RunStatus.RUNNING &&
      run.leaseExpiresAt &&
      run.leaseExpiresAt >= now
    ) {
      continue;
    }

    const job = await queue.getJob(run.id);
    if (!job) {
      report.missingJobs += 1;
      if (apply) await enqueueBrowserRun(queue, run.id);
    }
  }

  const jobs = await queue.getJobs([
    'waiting',
    'delayed',
    'completed',
    'failed',
  ]);
  for (const job of jobs) {
    const runId =
      typeof job.data?.runId === 'string' ? job.data.runId : undefined;
    const run = runId
      ? await prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        })
      : null;
    if (!run) {
      report.orphanJobs += 1;
      if (apply) await job.remove().catch(() => undefined);
    } else if (
      run.status !== RunStatus.QUEUED &&
      run.status !== RunStatus.RUNNING
    ) {
      report.terminalJobs += 1;
      if (apply) await job.remove().catch(() => undefined);
    }
  }
  console.info(JSON.stringify(report));
} finally {
  await queue.close();
  await prisma.$disconnect();
}
