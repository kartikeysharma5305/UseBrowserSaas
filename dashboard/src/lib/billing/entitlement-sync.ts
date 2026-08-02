import 'server-only';

// Accept plain Stripe objects (avoid tight dependency on Stripe TS shape during sync)
import type Stripe from 'stripe';
import { prisma } from '../db/prisma';
import { planCodeForStripePrice } from './price-catalogue';
import { STRIPE_TO_LOCAL_SUBSCRIPTION_STATUS } from './types';
import { chooseUserPlanAfterStripeUpdate } from './access';

interface SyncInput {
  eventId: string;
  eventCreatedAt: number; // epoch seconds from Stripe event.created
  // subscription can be a Stripe.Subscription or a plain JS object received from webhook
  subscription: any;
}

/**
 * Synchronize a verified Stripe subscription into local Subscription and User plan state.
 *
 * Guarantees and behaviors:
 * - Idempotent for the same eventId.
 * - Older events (by eventCreatedAt) will not overwrite newer state.
 * - Unknown price IDs will not grant PRO and will be recorded in the Subscription.stripePriceId field.
 * - INTERNAL user plan is preserved by chooseUserPlanAfterStripeUpdate.
 */
export async function syncStripeSubscriptionToLocal(input: SyncInput) {
  const { eventId, eventCreatedAt, subscription } = input;

  const stripeSubscriptionId = subscription.id;
  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : (subscription.customer as any)?.id;

  // Resolve price id from first item (supporting simple single-price subscriptions)
  const priceId =
    (subscription.items?.data && subscription.items.data[0]?.price?.id) ||
    (subscription.items?.data && (subscription.items.data[0] as any)?.price_id) ||
    null;

  // Map subscription status
  const stripeStatus = (subscription.status ?? '') as string;
  const localStatus = (STRIPE_TO_LOCAL_SUBSCRIPTION_STATUS as Record<string, string>)[stripeStatus] ?? 'INCOMPLETE';

  // Map plan code using price catalogue
  const planCode = priceId ? planCodeForStripePrice(priceId) : null;
  const effectivePlanCode = planCode ?? 'FREE';

  // Convert epoch timestamps (Stripe often uses seconds)
  function toDate(value: number | null | undefined) {
    if (!value) return null;
    // If appears to be milliseconds, normalize: treat large numbers as ms
    if (value > 1e12) return new Date(value);
    return new Date(value * 1000);
  }

  const currentPeriodStart = toDate((subscription.current_period_start as any) ?? (subscription.current_period?.start as any));
  const currentPeriodEnd = toDate((subscription.current_period_end as any) ?? (subscription.current_period?.end as any));
  const canceledAt = toDate((subscription.canceled_at as any) ?? (subscription.ended_at as any));
  const trialEndsAt = toDate((subscription.trial_end as any) ?? (subscription.trial_period_end as any));
  const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;

  // Transactional upsert & user update with ordering protection
  return await prisma.$transaction(async (tx) => {
    // Find user by stripeCustomerId
    const user = await tx.user.findUnique({ where: { stripeCustomerId: stripeCustomerId ?? undefined } });
    if (!user) {
      // No local user mapping for this Stripe customer. Record the subscription row with no userId (not allowed by schema), so instead return a safe error to let caller record the webhook event for reconciliation.
      throw new Error('No local user for Stripe customer');
    }

    // Fetch existing subscription if any
    const existing = await tx.subscription.findUnique({ where: { stripeSubscriptionId } });

    const eventDate = new Date(eventCreatedAt * 1000);

    if (existing) {
      // Ordering protection: if existing.lastStripeEventCreatedAt exists and is newer than this event, ignore
      if (existing.lastStripeEventCreatedAt && existing.lastStripeEventCreatedAt.getTime() > eventDate.getTime()) {
        return { action: 'skipped', reason: 'older_event' };
      }

      // Idempotency: if same event id already recorded, no-op
      if (existing.lastStripeEventId === eventId) {
        return { action: 'noop', reason: 'already_processed' };
      }

      // Update subscription
      await tx.subscription.update({
        where: { stripeSubscriptionId },
        data: {
          stripeCustomerId: stripeCustomerId ?? existing.stripeCustomerId,
          stripePriceId: priceId ?? existing.stripePriceId,
          status: localStatus as any,
          planCode: effectivePlanCode as any,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          canceledAt,
          trialEndsAt,
          lastStripeEventCreatedAt: eventDate,
          lastStripeEventId: eventId,
        },
      });
    } else {
      // Create subscription row
      await tx.subscription.create({
        data: {
          userId: user.id,
          provider: 'STRIPE',
          stripeSubscriptionId,
          stripeCustomerId: stripeCustomerId ?? '',
          stripePriceId: priceId ?? '',
          status: localStatus as any,
          planCode: effectivePlanCode as any,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          canceledAt,
          trialEndsAt,
          lastStripeEventCreatedAt: eventDate,
          lastStripeEventId: eventId,
        },
      });
    }

    // Decide effective user plan using existing helper which protects INTERNAL
    const decision = chooseUserPlanAfterStripeUpdate({
      currentPlanCode: user.planCode,
      currentPlanSource: user.planSource,
      subscriptionPlan: effectivePlanCode as any,
    });

    if (decision.planCode !== user.planCode || decision.planSource !== user.planSource) {
      await tx.user.update({ where: { id: user.id }, data: { planCode: decision.planCode, planSource: decision.planSource, planAssignedAt: new Date() } });
    }

    return { action: 'applied' };
  });
}
