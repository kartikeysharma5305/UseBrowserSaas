import { Worker } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { getNotificationQueueConfiguration } from '@/lib/notifications/config';
import { NotificationDeliveryProcessor } from '@/lib/notifications/delivery-processor';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import {
  closeOperationsRedis,
  recordOperationalHeartbeat,
} from '@/lib/operations/heartbeats';

const config = getNotificationQueueConfiguration();
await prisma.$queryRaw`SELECT 1`;
const processor = new NotificationDeliveryProcessor();
await enqueuePendingNotificationDeliveries();
const worker = new Worker(config.queueName, (job) => processor.process(job), {
  connection: config.workerConnection,
  concurrency: config.concurrency,
});
await worker.waitUntilReady();
await recordOperationalHeartbeat('notification-worker');
const healthHeartbeat = setInterval(
  () => void recordOperationalHeartbeat('notification-worker'),
  30_000
);
healthHeartbeat.unref();
worker.on('failed', (job, error) =>
  logger.warn('Notification delivery attempt failed', {
    deliveryId: job?.data.deliveryId,
    attempt: job?.attemptsMade,
    error: safeSerializeError(error),
  })
);
worker.on('error', (error) =>
  logger.error('Notification worker error', {
    error: safeSerializeError(error),
  })
);
logger.operation('info', {
  component: 'notification-worker',
  event: 'ready',
  queue: config.queueName,
  concurrency: config.concurrency,
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(healthHeartbeat);
  logger.info('Notification worker shutting down', { signal });
  await worker.close();
  closeOperationsRedis();
  await prisma.$disconnect();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
