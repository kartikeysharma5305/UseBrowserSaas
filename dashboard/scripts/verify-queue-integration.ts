import { randomUUID } from 'node:crypto';

import { Worker } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import {
  createBrowserRunQueue,
  enqueueBrowserRun,
} from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';

const redis = await RedisMemoryServer.create();
const host = await redis.getHost();
const port = await redis.getPort();
process.env.REDIS_URL = `redis://${host}:${port}`;
process.env.EXECUTION_QUEUE_NAME = `browser-run-verification-${randomUUID()}`;

const configuration = getQueueConfiguration();
const queue = createBrowserRunQueue(configuration);
let executionCount = 0;
const worker = new Worker(
  configuration.queueName,
  async (job) => {
    executionCount += 1;
    if (job.data.version !== 1 || typeof job.data.runId !== 'string') {
      throw new Error('Unexpected job payload.');
    }
  },
  { connection: configuration.workerConnection, concurrency: 1 }
);

try {
  const runId = randomUUID();
  const completed = new Promise<void>((resolve, reject) => {
    worker.once('completed', () => resolve());
    worker.once('failed', (_job, error) => reject(error));
  });
  await enqueueBrowserRun(queue, runId);
  await completed;
  const job = await queue.getJob(runId);
  if (!job || executionCount !== 1 || job.data.runId !== runId) {
    throw new Error('BullMQ integration verification failed.');
  }
  console.info(
    JSON.stringify({
      queue: configuration.queueName,
      status: 'verified',
      executionCount,
      payloadKeys: Object.keys(job.data).sort(),
    })
  );
} finally {
  await worker.close();
  await queue.close();
  await redis.stop();
}
