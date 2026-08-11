import { beforeEach, describe, expect, it } from 'vitest';

import { assertBillingEnabled, getBillingConfig } from '@/lib/billing/config';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
});

describe('billing config', () => {
  it('returns disabled billing config when billing is off', () => {
    process.env.BILLING_ENABLED = 'false';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRO_MONTHLY_PRICE_ID;

    const config = getBillingConfig();

    expect(config.enabled).toBe(false);
    expect(config.testMode).toBe(true);
    expect(config.billingEnabled).toBeUndefined();
  });

  it('validates Stripe configuration when billing is enabled', () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_123';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://localhost:3001/dashboard/billing?checkout=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:3001/dashboard/billing?checkout=canceled';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:3001/dashboard/billing';

    const config = getBillingConfig();

    expect(config.enabled).toBe(true);
    expect(config.secretKey).toBe('sk_test_123');
    expect(config.webhookSecret).toBe('whsec_123');
    expect(config.proMonthlyPriceId).toBe('price_123');
  });

  it('throws when enabled and Stripe price ID is invalid', () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'invalid-price';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://localhost:3001/dashboard/billing?checkout=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:3001/dashboard/billing?checkout=canceled';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:3001/dashboard/billing';

    expect(() => getBillingConfig()).toThrow(/STRIPE_PRO_MONTHLY_PRICE_ID must be a Stripe price ID/);
  });

  it('throws when enabled and checkout URL origin does not match app origin', () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_123';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://example.com/checkout-success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:3001/dashboard/billing?checkout=canceled';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:3001/dashboard/billing';

    expect(() => getBillingConfig()).toThrow(/STRIPE_CHECKOUT_SUCCESS_URL must use the configured application origin/);
  });
});
