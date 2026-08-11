import 'server-only';

import type { PlanCode, PlanSource, Subscription } from '@prisma/client';

const PAID_ACCESS_STATUSES = new Set(['ACTIVE', 'TRIALING']);

export function getEffectivePlanFromSubscription(
  subscription: Pick<
    Subscription,
    'status' | 'planCode' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'
  > | null,
  now = new Date()
): PlanCode {
  if (!subscription) return 'FREE';
  if (!PAID_ACCESS_STATUSES.has(subscription.status)) {
    // PAST_DUE retains access only for the Stripe-reported current period;
    // the application deliberately adds no separate grace period.
    if (
      subscription.status !== 'PAST_DUE' ||
      !subscription.currentPeriodEnd ||
      subscription.currentPeriodEnd.getTime() <= now.getTime()
    )
      return 'FREE';
  }
  if (
    subscription.cancelAtPeriodEnd &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  ) {
    return 'FREE';
  }
  return subscription.planCode === 'PRO' ? 'PRO' : 'FREE';
}

export function chooseUserPlanAfterStripeUpdate(input: {
  currentPlanCode: PlanCode;
  currentPlanSource: PlanSource;
  subscriptionPlan: PlanCode;
}): { planCode: PlanCode; planSource: PlanSource } {
  if (
    input.currentPlanCode === 'INTERNAL' ||
    input.currentPlanSource === 'INTERNAL'
  ) {
    return { planCode: 'INTERNAL', planSource: 'INTERNAL' };
  }
  return {
    planCode: input.subscriptionPlan,
    planSource: input.subscriptionPlan === 'PRO' ? 'STRIPE' : 'DEFAULT',
  };
}
