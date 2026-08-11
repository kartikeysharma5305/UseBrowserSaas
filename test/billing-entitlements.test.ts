import { describe, expect, it } from 'vitest';

import {
  chooseUserPlanAfterStripeUpdate,
  getEffectivePlanFromSubscription,
} from '@/lib/billing/access';

const now = new Date('2026-08-03T00:00:00.000Z');
const future = new Date('2026-08-04T00:00:00.000Z');
const past = new Date('2026-08-02T00:00:00.000Z');

function subscription(
  status: any,
  currentPeriodEnd: Date | null = future,
  cancelAtPeriodEnd = false
) {
  return {
    status,
    planCode: 'PRO' as const,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  };
}

describe('billing entitlement policy', () => {
  it.each(['ACTIVE', 'TRIALING'])(
    '%s grants PRO for a configured PRO subscription',
    (status) => {
      expect(getEffectivePlanFromSubscription(subscription(status), now)).toBe(
        'PRO'
      );
    }
  );

  it('retains PRO for PAST_DUE only through the current Stripe period', () => {
    expect(
      getEffectivePlanFromSubscription(subscription('PAST_DUE', future), now)
    ).toBe('PRO');
    expect(
      getEffectivePlanFromSubscription(subscription('PAST_DUE', past), now)
    ).toBe('FREE');
  });

  it.each(['UNPAID', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED', 'CANCELED'])(
    '%s does not grant paid access',
    (status) => {
      expect(getEffectivePlanFromSubscription(subscription(status), now)).toBe(
        'FREE'
      );
    }
  );

  it('keeps access for active cancel-at-period-end subscriptions until period end', () => {
    expect(
      getEffectivePlanFromSubscription(
        subscription('ACTIVE', future, true),
        now
      )
    ).toBe('PRO');
    expect(
      getEffectivePlanFromSubscription(subscription('ACTIVE', past, true), now)
    ).toBe('FREE');
  });

  it('never overwrites INTERNAL entitlement', () => {
    expect(
      chooseUserPlanAfterStripeUpdate({
        currentPlanCode: 'INTERNAL',
        currentPlanSource: 'INTERNAL',
        subscriptionPlan: 'FREE',
      })
    ).toEqual({ planCode: 'INTERNAL', planSource: 'INTERNAL' });
  });
});
