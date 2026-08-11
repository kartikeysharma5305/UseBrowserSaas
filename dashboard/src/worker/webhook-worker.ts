import { Worker } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { getWebhookConfiguration } from '@/lib/webhooks/config';
import { WebhookDeliveryProcessor } from '@/lib/webhooks/delivery-processor';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';
import {
  closeOperationsRedis,
  recordOperationalHeartbeat,
} from '@/lib/operations/heartbeats';

const config = getWebhookConfiguration();
await prisma.$queryRaw`SELECT 1`;
const processor = new WebhookDeliveryProcessor();
await enqueuePendingWebhookDeliveries();
const worker = new Worker(config.queueName, (job) => processor.process(job), {
  connection: config.workerConnection,
  concurrency: config.concurrency,
});
await worker.waitUntilReady();
await recordOperationalHeartbeat('webhook-worker');
const reconciliation = setInterval(() => {
  void enqueuePendingWebhookDeliveries().catch(() => undefined);
  void recordOperationalHeartbeat('webhook-worker');
}, 10_000);
reconciliation.unref();
worker.on('failed', (job, error) =>
  logger.warn('Outbound webhook delivery attempt failed', {
    deliveryId: job?.data.deliveryId,
    attempt: job?.attemptsMade,
    error: safeSerializeError(error),
  })
);
worker.on('error', (error) =>
  logger.error('Outbound webhook worker error', {
    error: safeSerializeError(error),
  })
);
logger.operation('info', {
  component: 'webhook-worker',
  event: 'ready',
  queue: config.queueName,
  concurrency: config.concurrency,
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(reconciliation);
  logger.info('Outbound webhook worker shutting down', { signal });
  await worker.close();
  closeOperationsRedis();
  await prisma.$disconnect();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
