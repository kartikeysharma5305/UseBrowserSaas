import { Queue } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/logger';

import { getNotificationQueueConfiguration } from './config';
import { notificationDeliveryJob, type NotificationDeliveryJob } from './job';

type DeliveryQueue = Queue<NotificationDeliveryJob>;
const globalQueue = globalThis as typeof globalThis & {
  notificationDeliveryQueue?: DeliveryQueue;
};

export function getNotificationDeliveryQueue() {
  if (!globalQueue.notificationDeliveryQueue) {
    const config = getNotificationQueueConfiguration();
    globalQueue.notificationDeliveryQueue = new Queue(config.queueName, {
      connection: config.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: 'exponential', delay: config.backoffMs },
        removeOnComplete: { age: 86_400, count: 2_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    });
    globalQueue.notificationDeliveryQueue.on('error', () =>
      logger.warn('Notification queue connection error', {
        code: 'NOTIFICATION_QUEUE_UNAVAILABLE',
      })
    );
  }
  return globalQueue.notificationDeliveryQueue;
}

type NotificationQueueWriter = Pick<DeliveryQueue, 'add'>;

export async function enqueueNotificationDelivery(
  deliveryId: string,
  queue: NotificationQueueWriter = getNotificationDeliveryQueue()
) {
  await queue.add(
    'deliver-email-notification',
    notificationDeliveryJob(deliveryId),
    { jobId: deliveryId }
  );
}

export async function enqueuePendingNotificationDeliveries(
  limit = 100,
  enqueue: (deliveryId: string) => Promise<void> = enqueueNotificationDelivery
) {
  const now = new Date();
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
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

export async function closeNotificationDeliveryQueue() {
  const queue = globalQueue.notificationDeliveryQueue;
  delete globalQueue.notificationDeliveryQueue;
  if (queue) await queue.close();
}
