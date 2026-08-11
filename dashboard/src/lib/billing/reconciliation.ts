import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { getBillingConfig } from './config';
import { syncStripeSubscription } from './entitlement-sync';
import { getStripeClient } from './stripe-client';
import { planCodeForStripePrice } from './price-catalogue';

export type BillingReconciliationIssue = {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  userIdSuffix?: string;
  subscriptionIdSuffix?: string;
  customerIdSuffix?: string;
  repairable: boolean;
  message: string;
};

export type BillingReconciliationResult = {
  inspected: number;
  repaired: number;
  failed: number;
  issues: BillingReconciliationIssue[];
};

const suffix = (value: string | null | undefined) =>
  value ? value.slice(-8) : undefined;

/** Bounded local-first audit; Stripe remains read-only except for retrieval. */
export async function reconcileBilling(
  options: { apply?: boolean; limit?: number } = {}
): Promise<BillingReconciliationResult> {
  if (!getBillingConfig().enabled)
    throw new Error('Billing reconciliation requires BILLING_ENABLED=true.');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const issues: BillingReconciliationIssue[] = [];
  let repaired = 0;
  let failed = 0;
  const stripe = getStripeClient();
  const subscriptions = await prisma.subscription.findMany({
    where: {
      OR: [
        { user: { accountDeletion: { is: null } } },
        {
          user: {
            accountDeletion: { is: { status: { not: 'COMPLETED' } } },
          },
        },
      ],
    },
    take: limit,
    orderBy: { updatedAt: 'asc' },
    include: {
      user: {
        select: {
          id: true,
          planCode: true,
          planSource: true,
          stripeCustomerId: true,
        },
      },
    },
  });
  for (const local of subscriptions) {
    try {
      const remote = await stripe.subscriptions.retrieve(
        local.stripeSubscriptionId,
        { expand: ['items.data.price', 'customer'] }
      );
      const priceId = remote.items.data[0]?.price.id ?? '';
      const priceMismatch = priceId !== local.stripePriceId;
      const statusMismatch = remote.status.toUpperCase() !== local.status;
      const remoteCustomerId =
        typeof remote.customer === 'string'
          ? remote.customer
          : remote.customer.id;
      if (remoteCustomerId !== local.stripeCustomerId)
        issues.push({
          code: 'CUSTOMER_MISMATCH',
          severity: 'CRITICAL',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          customerIdSuffix: suffix(remoteCustomerId),
          repairable: false,
          message: 'Subscription customer does not match local billing record.',
        });
      if (priceMismatch)
        issues.push({
          code: 'PRICE_MISMATCH',
          severity: 'WARNING',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          repairable: true,
          message: 'Local subscription price differs from Stripe.',
        });
      if (!planCodeForStripePrice(priceId))
        issues.push({
          code: 'UNKNOWN_STRIPE_PRICE',
          severity: 'CRITICAL',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          repairable: false,
          message:
            'Stripe subscription uses a price that is not recognized by this application.',
        });
      if (statusMismatch)
        issues.push({
          code: 'STATUS_MISMATCH',
          severity: 'WARNING',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          repairable: true,
          message: 'Local subscription status differs from Stripe.',
        });
      const expectedPlan =
        remote.status === 'active' ||
        remote.status === 'trialing' ||
        (remote.status === 'past_due' &&
          local.currentPeriodEnd &&
          local.currentPeriodEnd > new Date())
          ? 'PRO'
          : 'FREE';
      const entitlementMismatch =
        local.user.planCode !== 'INTERNAL' &&
        local.user.planCode !== expectedPlan;
      if (entitlementMismatch)
        issues.push({
          code: 'ENTITLEMENT_MISMATCH',
          severity: 'WARNING',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          repairable: true,
          message:
            'Local user plan does not match the recognized Stripe subscription.',
        });
      if (local.user.planCode === 'INTERNAL')
        issues.push({
          code: 'INTERNAL_PROTECTED',
          severity: 'INFO',
          userIdSuffix: suffix(local.userId),
          subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
          repairable: false,
          message:
            'Internal entitlement is intentionally protected from Stripe changes.',
        });
      if (
        options.apply &&
        remoteCustomerId === local.stripeCustomerId &&
        planCodeForStripePrice(priceId) &&
        (priceMismatch || statusMismatch || entitlementMismatch)
      ) {
        await syncStripeSubscription(remote, {
          stripeEventId: `reconcile:${remote.id}`,
          // Reconciliation is a fresh authoritative read, not the historical
          // subscription-created event. Using the audit time allows it to
          // repair state newer than the original subscription timestamp.
          stripeEventCreatedAt: new Date(),
          fallbackUserId: local.userId,
        });
        repaired += 1;
      }
    } catch (error: any) {
      const missing = error?.code === 'resource_missing';
      issues.push({
        code: missing ? 'MISSING_STRIPE_SUBSCRIPTION' : 'STRIPE_LOOKUP_FAILED',
        severity: missing ? 'CRITICAL' : 'WARNING',
        userIdSuffix: suffix(local.userId),
        subscriptionIdSuffix: suffix(local.stripeSubscriptionId),
        repairable: false,
        message: missing
          ? 'Local subscription no longer exists in Stripe.'
          : 'Stripe lookup failed for one subscription.',
      });
      failed += 1;
    }
  }
  // Customers with a mapping but no local subscription may represent missed webhooks.
  const customers = await prisma.user.findMany({
    where: {
      stripeCustomerId: { not: null },
      OR: [
        { accountDeletion: { is: null } },
        { accountDeletion: { is: { status: { not: 'COMPLETED' } } } },
      ],
    },
    take: limit,
    select: {
      id: true,
      stripeCustomerId: true,
      planCode: true,
      subscription: { select: { id: true } },
    },
  });
  for (const user of customers) {
    if (user.subscription) continue;
    try {
      const remoteSubscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId!,
        status: 'all',
        limit: 10,
        expand: ['data.items.data.price'],
      });
      const valid = remoteSubscriptions.data.find(
        (item) =>
          planCodeForStripePrice(item.items.data[0]?.price.id ?? '') &&
          ['active', 'trialing', 'past_due'].includes(item.status)
      );
      if (valid) {
        issues.push({
          code: 'MISSING_LOCAL_SUBSCRIPTION',
          severity: 'WARNING',
          userIdSuffix: suffix(user.id),
          subscriptionIdSuffix: suffix(valid.id),
          customerIdSuffix: suffix(user.stripeCustomerId),
          repairable: true,
          message: 'A recognized Stripe subscription is missing locally.',
        });
        if (options.apply) {
          await syncStripeSubscription(valid, {
            stripeEventId: `reconcile:${valid.id}`,
            stripeEventCreatedAt: new Date(valid.created * 1000),
            fallbackUserId: user.id,
          });
          repaired += 1;
        }
      } else if (user.planCode === 'PRO') {
        issues.push({
          code: 'STRIPE_PRO_WITHOUT_SUBSCRIPTION',
          severity: 'CRITICAL',
          userIdSuffix: suffix(user.id),
          customerIdSuffix: suffix(user.stripeCustomerId),
          repairable: true,
          message:
            'A Stripe-sourced PRO entitlement has no valid recognized subscription.',
        });
        if (options.apply) {
          await prisma.user.update({
            where: { id: user.id },
            data: { planCode: 'FREE', planSource: 'DEFAULT' },
          });
          repaired += 1;
        }
      }
    } catch {
      issues.push({
        code: 'CUSTOMER_LOOKUP_FAILED',
        severity: 'WARNING',
        userIdSuffix: suffix(user.id),
        customerIdSuffix: suffix(user.stripeCustomerId),
        repairable: false,
        message: 'Stripe customer subscriptions could not be inspected.',
      });
      failed += 1;
    }
  }
  const failedEvents = await prisma.billingWebhookEvent.findMany({
    where: { processingState: { in: ['FAILED', 'PROCESSING'] } },
    take: limit,
    select: { id: true, processingState: true, receivedAt: true },
  });
  for (const event of failedEvents)
    issues.push({
      code:
        event.processingState === 'FAILED' ? 'FAILED_WEBHOOK' : 'STALE_WEBHOOK',
      severity: 'WARNING',
      subscriptionIdSuffix: suffix(event.id),
      repairable: false,
      message:
        event.processingState === 'FAILED'
          ? 'A billing webhook requires reconciliation.'
          : 'A webhook remains in processing state.',
    });
  return { inspected: subscriptions.length, repaired, failed, issues };
}
