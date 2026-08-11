import { Queue } from 'bullmq';

import {
  ExecutionServiceError,
  safeSerializeError,
} from '@/lib/execution/errors';
import { logger } from '@/lib/logger';

import { browserRunJob } from './browser-run-job';
import {
  getQueueConfiguration,
  getRunJobOptions,
  type QueueConfiguration,
} from './config';

type BrowserRunQueue = Queue<ReturnType<typeof browserRunJob>>;

const globalQueue = globalThis as typeof globalThis & {
  browserRunQueue?: BrowserRunQueue;
};

export function createBrowserRunQueue(
  configuration = getQueueConfiguration()
): BrowserRunQueue {
  const queue = new Queue(configuration.queueName, {
    connection: configuration.connection,
    defaultJobOptions: getRunJobOptions(configuration),
  });
  queue.on('error', (error) => {
    logger.warn('Execution queue connection error', {
      code: 'QUEUE_UNAVAILABLE',
      error: safeSerializeError(error),
    });
  });
  return queue;
}

export function getBrowserRunQueue(): BrowserRunQueue {
  globalQueue.browserRunQueue ??= createBrowserRunQueue();
  return globalQueue.browserRunQueue;
}

export async function assertQueueHasCapacity(
  queue: BrowserRunQueue,
  configuration: QueueConfiguration
): Promise<void> {
  await queue.waitUntilReady();
  const counts = await queue.getJobCounts('waiting', 'delayed', 'prioritized');
  const pending =
    (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
  if (pending >= configuration.maxWaiting) {
    throw new ExecutionServiceError('QUEUE_BACKPRESSURE', {
      stage: 'queue_reserve',
    });
  }
}

export async function enqueueBrowserRun(
  queue: BrowserRunQueue,
  runId: string
): Promise<void> {
  await queue.add('execute-browser-run', browserRunJob(runId), {
    jobId: runId,
  });
}

export async function closeBrowserRunQueue(): Promise<void> {
  if (!globalQueue.browserRunQueue) return;
  const queue = globalQueue.browserRunQueue;
  delete globalQueue.browserRunQueue;
  await queue.close();
}
