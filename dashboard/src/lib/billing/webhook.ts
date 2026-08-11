import type Stripe from 'stripe';

import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/logger';
import { classifyStripeError, getStripeClient } from './stripe-client';
import { syncStripeSubscription } from './entitlement-sync';
import { emitBillingAlerts } from '@/lib/notifications/events';
import { incrementCounter } from '@/lib/operations/metrics';

async function claimEvent(event: Stripe.Event) {
  try {
    await prisma.billingWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        stripeCreatedAt: new Date(event.created * 1000),
        processingState: 'PROCESSING',
      },
    });
    return true;
  } catch {
    const record = await prisma.billingWebhookEvent.findUnique({
      where: { id: event.id },
      select: { processingState: true },
    });
    if (
      !record ||
      record.processingState === 'PROCESSED' ||
      record.processingState === 'PROCESSING'
    )
      return false;
    // FAILED is deliberately reclaimable so a Stripe retry can complete it.
    const claimed = await prisma.billingWebhookEvent.updateMany({
      where: { id: event.id, processingState: 'FAILED' },
      data: {
        processingState: 'PROCESSING',
        processedAt: null,
        errorCode: null,
      },
    });
    return claimed.count === 1;
  }
}

export async function handleStripeWebhookEvent(event: Stripe.Event) {
  if (!(await claimEvent(event))) {
    incrementCounter('billing_webhook_requests_total', {
      outcome: 'duplicate',
    });
    return;
  }
  try {
    await processStripeEvent(event);
    await prisma.billingWebhookEvent.update({
      where: { id: event.id },
      data: {
        processingState: 'PROCESSED',
        processedAt: new Date(),
        errorCode: null,
      },
    });
  } catch (error) {
    const errorCode = classifyStripeError(error);
    await prisma.billingWebhookEvent.update({
      where: { id: event.id },
      data: { processingState: 'FAILED', processedAt: new Date(), errorCode },
    });
    logger.warn('Stripe webhook processing failed', {
      eventId: event.id,
      type: event.type,
      errorCode,
    });
    throw error;
  }
}

function metadataUserId(metadata: Stripe.Metadata | null | undefined) {
  return typeof metadata?.internalUserId === 'string'
    ? metadata.internalUserId
    : undefined;
}

async function sync(
  subscription: Stripe.Subscription,
  event: Stripe.Event,
  fallbackUserId?: string
) {
  if (fallbackUserId) {
    const deletion = await prisma.accountDeletion.findUnique({
      where: { userId: fallbackUserId },
      select: { status: true },
    });
    if (deletion?.status === 'COMPLETED') return;
  }
  return syncStripeSubscription(subscription, {
    stripeEventId: event.id,
    stripeEventCreatedAt: new Date(event.created * 1000),
    fallbackUserId,
  });
}

async function retrieveSubscription(id: string) {
  return getStripeClient().subscriptions.retrieve(id, {
    expand: ['items.data.price', 'customer'],
  });
}

async function processStripeEvent(event: Stripe.Event) {
  const notify = async (subscriptionId: string) =>
    emitBillingAlerts({
      stripeSubscriptionId: subscriptionId,
      eventType: event.type,
      eventId: event.id,
    }).catch(() => undefined);
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription')
        throw new Error('Checkout session is not a subscription session.');
      const id =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      if (!id || !session.customer)
        throw new Error(
          'Checkout session is missing customer or subscription.'
        );
      const subscription = await retrieveSubscription(id);
      await sync(subscription, event, metadataUserId(session.metadata));
      await notify(subscription.id);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await sync(subscription, event, metadataUserId(subscription.metadata));
      await notify(subscription.id);
      return;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscription =
        invoice.parent?.subscription_details?.subscription;
      const id =
        typeof invoiceSubscription === 'string'
          ? invoiceSubscription
          : invoiceSubscription?.id;
      if (!id) return;
      const subscription = await retrieveSubscription(id);
      await sync(subscription, event, metadataUserId(invoice.metadata));
      if (event.type === 'invoice.payment_failed') {
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            paymentFailureAt: new Date(),
            paymentFailureCode: 'PAYMENT_FAILED',
          },
        });
      }
      await notify(subscription.id);
      return;
    }
    default:
      return;
  }
}
