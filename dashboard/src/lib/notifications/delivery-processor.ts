import { UnrecoverableError, type Job } from 'bullmq';

import { prisma } from '@/lib/db/prisma';

import {
  getEmailConfiguration,
  getNotificationQueueConfiguration,
} from './config';
import {
  notificationDeliveryJobSchema,
  type NotificationDeliveryJob,
} from './job';
import { createEmailProvider, type EmailProvider } from './provider';
import { renderNotificationEmail } from './templates';

export class NotificationDeliveryProcessor {
  constructor(
    private readonly provider: EmailProvider | null = createEmailProvider()
  ) {}

  async process(job: Job<NotificationDeliveryJob>) {
    const payload = notificationDeliveryJobSchema.safeParse(job.data);
    if (!payload.success)
      throw new UnrecoverableError('Invalid notification delivery payload.');
    const config = getNotificationQueueConfiguration();
    const email = getEmailConfiguration();
    const now = new Date();
    const delivery = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${payload.data.deliveryId}, 0))`;
      const current = await transaction.notificationDelivery.findUnique({
        where: { id: payload.data.deliveryId },
        include: { notification: true },
      });
      if (!current || ['SENT', 'FAILED', 'SUPPRESSED'].includes(current.status))
        return null;
      if (
        current.status === 'PROCESSING' &&
        current.processingLeaseUntil &&
        current.processingLeaseUntil > now
      )
        return null;
      return transaction.notificationDelivery.update({
        where: { id: current.id },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          processingLeaseUntil: new Date(now.getTime() + config.leaseMs),
          failureCode: null,
          failureMessage: null,
        },
        include: { notification: true },
      });
    });
    if (!delivery) return;
    if (!email.enabled || !this.provider) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUPPRESSED',
          processingLeaseUntil: null,
          failureCode: 'EMAIL_DISABLED',
        },
      });
      return;
    }
    try {
      const template = renderNotificationEmail({
        type: delivery.notification.type,
        payload: delivery.notification.payload as Record<string, unknown>,
        appBaseUrl: email.appBaseUrl,
      });
      const sent = await this.provider.send({
        ...template,
        to: delivery.recipientEmail,
        idempotencyKey: delivery.notification.idempotencyKey,
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: sent.messageId.slice(0, 160),
          processingLeaseUntil: null,
          failureCode: null,
          failureMessage: null,
        },
      });
    } catch (error) {
      const terminal = delivery.attemptCount >= config.attempts;
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: terminal ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(
            Date.now() +
              config.backoffMs * 2 ** Math.max(0, delivery.attemptCount - 1)
          ),
          processingLeaseUntil: null,
          failureCode: 'EMAIL_DELIVERY_FAILED',
          failureMessage: 'Email delivery failed safely.',
        },
      });
      if (terminal)
        throw new UnrecoverableError('Email delivery attempts exhausted.');
      throw new Error('Email delivery will be retried.');
    }
  }
}
