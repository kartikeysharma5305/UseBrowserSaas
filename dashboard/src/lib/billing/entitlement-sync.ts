import type Stripe from 'stripe';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import {
  chooseUserPlanAfterStripeUpdate,
  getEffectivePlanFromSubscription,
} from './access';
import { planCodeForStripePrice } from './price-catalogue';
import { STRIPE_TO_LOCAL_SUBSCRIPTION_STATUS } from './types';

interface SyncStripeSubscriptionOptions {
  stripeEventId: string;
  stripeEventCreatedAt: Date;
  fallbackUserId?: string;
}

/** The webhook is retained as failed for reconciliation, after recording FREE state. */
export class UnknownStripePriceError extends Error {
  constructor() {
    super('Stripe subscription references an unconfigured price.');
    this.name = 'UnknownStripePriceError';
  }
}

function stripeId(value: string | { id: string } | null | undefined) {
  return value ? (typeof value === 'string' ? value : value.id) : null;
}

function toDate(value: number | null | undefined) {
  return value ? new Date(value * 1000) : null;
}

async function resolveUser(
  tx: Prisma.TransactionClient,
  stripeCustomerId: string | null,
  fallbackUserId?: string
) {
  if (stripeCustomerId) {
    const mapped = await tx.user.findUnique({
      where: { stripeCustomerId },
      select: {
        id: true,
        planCode: true,
        planSource: true,
        stripeCustomerId: true,
      },
    });
    if (mapped) return mapped;
  }
  if (!fallbackUserId) return null;

  const user = await tx.user.findUnique({
    where: { id: fallbackUserId },
    select: {
      id: true,
      planCode: true,
      planSource: true,
      stripeCustomerId: true,
    },
  });
  if (!user) return null;
  if (
    stripeCustomerId &&
    user.stripeCustomerId &&
    user.stripeCustomerId !== stripeCustomerId
  ) {
    throw new Error('Stripe customer does not match the local user mapping.');
  }
  if (stripeCustomerId && !user.stripeCustomerId) {
    await tx.user.update({
      where: { id: user.id },
      data: { stripeCustomerId },
    });
    return { ...user, stripeCustomerId };
  }
  return user;
}

/**
 * The single authoritative Stripe-to-local state transition. It stores every
 * verified subscription snapshot, updates the user in the same transaction,
 * and ignores snapshots no newer than the stored Stripe event timestamp.
 */
export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  options: SyncStripeSubscriptionOptions
) {
  if (!subscription.id)
    throw new Error('Stripe subscription payload is missing an ID.');

  const stripeCustomerId = stripeId(subscription.customer);
  const item = subscription.items.data[0];
  const priceId = stripeId(item?.price) ?? '';
  const configuredPlan = planCodeForStripePrice(priceId);
  const planCode = configuredPlan ?? 'FREE';
  const status =
    STRIPE_TO_LOCAL_SUBSCRIPTION_STATUS[subscription.status] ?? 'INCOMPLETE';
  const currentPeriodStart = toDate(item?.current_period_start);
  const currentPeriodEnd = toDate(item?.current_period_end);
  const eventCreatedAt = options.stripeEventCreatedAt;

  await prisma.$transaction(async (tx) => {
    const user = await resolveUser(
      tx,
      stripeCustomerId,
      options.fallbackUserId
    );
    if (!user)
      throw new Error('No local user mapping exists for this Stripe customer.');
    if (!stripeCustomerId && !user.stripeCustomerId) {
      throw new Error(
        'Stripe subscription payload is missing a customer reference.'
      );
    }

    const existing = await tx.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
      select: { lastStripeEventCreatedAt: true },
    });
    // Stripe's created timestamp is authoritative. Equal timestamps are left
    // unchanged: they cannot establish a reliable ordering and replay safety
    // is preferable to replacing an already accepted snapshot.
    if (
      existing?.lastStripeEventCreatedAt &&
      existing.lastStripeEventCreatedAt >= eventCreatedAt
    )
      return;

    const effectivePlan = getEffectivePlanFromSubscription({
      status,
      planCode,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    });
    const userPlan = chooseUserPlanAfterStripeUpdate({
      currentPlanCode: user.planCode,
      currentPlanSource: user.planSource,
      subscriptionPlan: effectivePlan,
    });

    await tx.subscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      create: {
        userId: user.id,
        provider: 'STRIPE',
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: stripeCustomerId ?? user.stripeCustomerId!,
        stripePriceId: priceId,
        status,
        planCode,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        canceledAt: toDate(subscription.canceled_at),
        trialEndsAt: toDate(subscription.trial_end),
        lastStripeEventCreatedAt: eventCreatedAt,
        lastStripeEventId: options.stripeEventId,
      },
      update: {
        stripeCustomerId: stripeCustomerId ?? user.stripeCustomerId!,
        stripePriceId: priceId,
        status,
        planCode,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        canceledAt: toDate(subscription.canceled_at),
        trialEndsAt: toDate(subscription.trial_end),
        lastStripeEventCreatedAt: eventCreatedAt,
        lastStripeEventId: options.stripeEventId,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        planCode: userPlan.planCode,
        planSource: userPlan.planSource,
        ...(userPlan.planCode !== user.planCode ||
        userPlan.planSource !== user.planSource
          ? { planAssignedAt: new Date() }
          : {}),
      },
    });
  });

  if (!configuredPlan) throw new UnknownStripePriceError();
}
