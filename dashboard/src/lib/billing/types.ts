import type {
  PlanCode,
  Subscription,
  SubscriptionStatus,
} from '@prisma/client';

export const PURCHASABLE_BILLING_PLANS = ['PRO'] as const;
export type PurchasableBillingPlan = (typeof PURCHASABLE_BILLING_PLANS)[number];

export interface BillingStatus {
  planCode: PlanCode;
  planSource: string;
  billingEnabled: boolean;
  testMode: boolean;
  subscription: Pick<
    Subscription,
    | 'status'
    | 'currentPeriodStart'
    | 'currentPeriodEnd'
    | 'cancelAtPeriodEnd'
    | 'canceledAt'
    | 'paymentFailureAt'
  > | null;
  actions: {
    canUpgrade: boolean;
    canManageBilling: boolean;
  };
}

export const STRIPE_TO_LOCAL_SUBSCRIPTION_STATUS = {
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
} satisfies Record<string, SubscriptionStatus>;
