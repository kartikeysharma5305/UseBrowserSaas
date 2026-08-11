import { prisma } from '@/lib/db/prisma';
import {
  closeNotificationDeliveryQueue,
  enqueuePendingNotificationDeliveries,
} from '@/lib/notifications/queue';

const rawLimit = Number(process.argv[2] ?? 100);
const limit = Number.isSafeInteger(rawLimit)
  ? Math.min(500, Math.max(1, rawLimit))
  : 100;

try {
  const enqueued = await enqueuePendingNotificationDeliveries(limit);
  console.log(
    JSON.stringify({ operation: 'notification-reconciliation', enqueued })
  );
} finally {
  await closeNotificationDeliveryQueue();
  await prisma.$disconnect();
}
