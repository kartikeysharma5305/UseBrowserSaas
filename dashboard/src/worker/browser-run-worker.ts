import { Worker } from 'bullmq';

import { EngineLoader } from '@/lib/browser/engine-loader';
import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { getQueueConfiguration } from '@/lib/queue/config';
import { RunNotificationSubscriber } from '@/lib/realtime/run-notifications';
import { BrowserRunProcessor } from '@/lib/worker/browser-run-processor';
import { drainBrowserWorker } from '@/lib/worker/worker-drain';
import {
  createWorkerInstanceId,
  heartbeatWorkerInstance,
  markLostWorkerInstances,
  registerWorkerInstance,
  stopWorkerInstance,
  workerBuildVersion,
} from '@/lib/worker/worker-health';
import { installBrowserShutdownRejectionContainment } from '@/lib/worker/unhandled-browser-rejection';

const configuration = getQueueConfiguration();
const workerId = createWorkerInstanceId();
const shutdownController = new AbortController();
const removeBrowserShutdownRejectionContainment =
  installBrowserShutdownRejectionContainment();
let draining = false;

// The root engine's info stream includes task/model output; worker logs use the
// dashboard's bounded structured logger instead.
process.env.BROWSER_USE_LOGGING_LEVEL = 'error';
await Promise.all([
  new EngineLoader().loadEngineModules(),
  prisma.$queryRaw`SELECT 1`,
]);
await markLostWorkerInstances(
  new Date(
    Date.now() -
      Math.max(
        configuration.workerHealthHeartbeatMs * 4,
        configuration.leaseMs * 2
      )
  )
);
await registerWorkerInstance({
  id: workerId,
  concurrency: configuration.concurrency,
  buildVersion: workerBuildVersion(),
});

const processor = new BrowserRunProcessor(workerId, configuration);
const cancellationSubscriber = new RunNotificationSubscriber();
await cancellationSubscriber.start((notification) => {
  if (notification.kind === 'cancel') {
    void processor.requestCancellation(notification.runId).catch((error) => {
      logger.warn('Worker cancellation notification check failed', {
        runId: notification.runId,
        error: safeSerializeError(error),
      });
    });
  }
});
const worker = new Worker(
  configuration.queueName,
  (job) => processor.process(job),
  {
    connection: configuration.workerConnection,
    concurrency: configuration.concurrency,
  }
);
await worker.waitUntilReady();
await heartbeatWorkerInstance({
  id: workerId,
  status: 'ACTIVE',
  activeCount: 0,
});

const healthHeartbeat = setInterval(() => {
  void heartbeatWorkerInstance({
    id: workerId,
    status: draining ? 'DRAINING' : 'ACTIVE',
    activeCount: processor.activeCount,
  }).catch((error) => {
    logger.warn('Browser worker health heartbeat failed', {
      workerId,
      error: safeSerializeError(error),
    });
  });
}, configuration.workerHealthHeartbeatMs);

worker.on('completed', (job) => {
  logger.info('Browser queue job completed', {
    runId: job.data.runId,
    jobId: job.id,
  });
});
worker.on('failed', (job, error) => {
  logger.error('Browser queue job attempt failed', {
    runId: job?.data.runId,
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: safeSerializeError(error),
  });
});
worker.on('error', (error) => {
  logger.error('Browser worker error', {
    error: safeSerializeError(error),
  });
});

logger.operation('info', {
  component: 'browser-worker',
  event: 'ready',
  workerId,
  queue: configuration.queueName,
  concurrency: configuration.concurrency,
});

async function shutdown(signal: string) {
  if (shutdownController.signal.aborted) return;
  shutdownController.abort();
  draining = true;
  logger.operation('info', {
    component: 'browser-worker',
    event: 'draining',
    workerId,
    signal,
    activeCount: processor.activeCount,
  });
  await heartbeatWorkerInstance({
    id: workerId,
    status: 'DRAINING',
    activeCount: processor.activeCount,
  });
  const result = await drainBrowserWorker({
    worker,
    activeCount: () => processor.activeCount,
    abortActive: () => processor.abortAll(),
    drainTimeoutMs: configuration.shutdownGraceMs,
    cleanupTimeoutMs: configuration.browserShutdownMs,
  });
  if (result.forced) {
    logger.warn('Aborting active runs after worker shutdown grace period', {
      workerId,
      cleanupCompleted: result.cleanupCompleted,
    });
  }
  clearInterval(healthHeartbeat);
  removeBrowserShutdownRejectionContainment();
  await cancellationSubscriber.close();
  await stopWorkerInstance(workerId);
  await prisma.$disconnect();
}

async function handleShutdown(signal: string) {
  try {
    await shutdown(signal);
    process.exit(0);
  } catch (error) {
    logger.error('Browser worker shutdown failed', {
      workerId,
      signal,
      error: safeSerializeError(error),
    });
    process.exit(1);
  }
}

process.once('SIGINT', () => void handleShutdown('SIGINT'));
process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
process.on('message', (message) => {
  if (message === 'browser-worker:shutdown') {
    void handleShutdown('IPC');
  }
});
