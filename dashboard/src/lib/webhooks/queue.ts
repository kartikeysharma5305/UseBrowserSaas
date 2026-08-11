import { Queue } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/logger';
import { getWebhookConfiguration } from './config';
import { webhookDeliveryJob, type WebhookDeliveryJob } from './job';

type WebhookQueue = Queue<WebhookDeliveryJob>;
const globalQueue = globalThis as typeof globalThis & {
  outboundWebhookQueue?: WebhookQueue;
};

export function getOutboundWebhookQueue() {
  if (!globalQueue.outboundWebhookQueue) {
    const config = getWebhookConfiguration();
    const queue = new Queue<WebhookDeliveryJob>(config.queueName, {
      connection: config.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: 'exponential', delay: config.backoffMs },
        removeOnComplete: { age: 86_400, count: 2_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    });
    queue.on('error', () =>
      logger.warn('Outbound webhook queue connection error', {
        code: 'WEBHOOK_QUEUE_UNAVAILABLE',
      })
    );
    globalQueue.outboundWebhookQueue = queue;
  }
  return globalQueue.outboundWebhookQueue;
}

export async function enqueueWebhookDelivery(
  deliveryId: string,
  queue: Pick<WebhookQueue, 'add' | 'getJob'> = getOutboundWebhookQueue()
) {
  const existing = await queue.getJob(deliveryId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') await existing.remove();
    else return;
  }
  await queue.add('deliver-outbound-webhook', webhookDeliveryJob(deliveryId), {
    jobId: deliveryId,
  });
}

export async function enqueuePendingWebhookDeliveries(
  limit = 100,
  enqueue: (deliveryId: string) => Promise<void> = enqueueWebhookDelivery
) {
  const now = new Date();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      endpoint: { status: 'ENABLED' },
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', processingLeaseUntil: { lt: now } },
      ],
    },
    select: { id: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: Math.min(500, Math.max(1, limit)),
  });
  for (const delivery of deliveries) await enqueue(delivery.id);
  return deliveries.length;
}

export async function closeOutboundWebhookQueue() {
  const queue = globalQueue.outboundWebhookQueue;
  delete globalQueue.outboundWebhookQueue;
  if (queue) await queue.close();
}

export async function removeWebhookJobsForUser(userId: string) {
  const deliveryIds = await prisma.webhookDelivery.findMany({
    where: {
      endpoint: { userId },
      status: { in: ['PENDING', 'PROCESSING', 'SUPPRESSED'] },
    },
    select: { id: true },
    take: 1_000,
  });
  return removeWebhookJobs(deliveryIds.map((delivery) => delivery.id));
}

export async function removeWebhookJobs(deliveryIds: string[]) {
  const queue = getOutboundWebhookQueue();
  for (const deliveryId of deliveryIds.slice(0, 1_000)) {
    const job = await queue.getJob(deliveryId);
    if (job) await job.remove().catch(() => undefined);
  }
  return deliveryIds.length;
}
