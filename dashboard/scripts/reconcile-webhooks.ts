import { prisma } from '../src/lib/db/prisma';
import {
  closeOutboundWebhookQueue,
  enqueuePendingWebhookDeliveries,
} from '../src/lib/webhooks/queue';

try {
  const enqueued = await enqueuePendingWebhookDeliveries(500);
  console.info(JSON.stringify({ operation: 'webhook-reconcile', enqueued }));
} finally {
  await closeOutboundWebhookQueue();
  await prisma.$disconnect();
}
