import 'server-only';

import type { PlanCode } from '@prisma/client';

import { assertBillingEnabled } from './config';
import type { PurchasableBillingPlan } from './types';

export interface StripePlanPrice {
  key: 'PRO_MONTHLY';
  plan: PurchasableBillingPlan;
  planCode: PlanCode;
  priceId: string;
}

export function getStripePlanPrices(): Record<'PRO_MONTHLY', StripePlanPrice> {
  const config = assertBillingEnabled();
  return {
    PRO_MONTHLY: {
      key: 'PRO_MONTHLY',
      plan: 'PRO',
      planCode: 'PRO',
      priceId: config.proMonthlyPriceId,
    },
  };
}

export function getStripePriceForPlan(plan: PurchasableBillingPlan) {
  const prices = getStripePlanPrices();
  if (plan === 'PRO') return prices.PRO_MONTHLY;
  throw new Error('Unsupported billing plan.');
}

export function planCodeForStripePrice(priceId: string): PlanCode | null {
  const prices = getStripePlanPrices();
  return (
    Object.values(prices).find((price) => price.priceId === priceId)
      ?.planCode ?? null
  );
}
