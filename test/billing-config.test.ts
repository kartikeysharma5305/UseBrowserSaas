import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// mock Next.js server-only virtual module used in billing codepaths
vi.mock('server-only', () => ({}));

const OLD_ENV = { ...process.env };

describe('billing config and price catalogue', () => {
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('returns disabled config when BILLING_ENABLED is false', async () => {
    process.env.BILLING_ENABLED = 'false';
    const { getBillingConfig } = await import('../dashboard/src/lib/billing/config.js');
    const cfg = getBillingConfig();
    expect(cfg.enabled).toBe(false);
  });

  it('maps configured STRIPE_PRO_MONTHLY_PRICE_ID to PRO plan when billing enabled', async () => {
    process.env.BILLING_ENABLED = 'true';
    // minimal required env for config validation
    process.env.STRIPE_SECRET_KEY = 'sk_test_123456';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_test_abcdef';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://localhost:3001/dashboard/billing?checkout=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:3001/dashboard/billing?checkout=canceled';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:3001/dashboard/billing';

    const { getStripePriceForPlan, planCodeForStripePrice } = await import('../dashboard/src/lib/billing/price-catalogue.js');

    const price = getStripePriceForPlan('PRO');
    expect(price.priceId).toBe(process.env.STRIPE_PRO_MONTHLY_PRICE_ID);
    const mapped = planCodeForStripePrice(process.env.STRIPE_PRO_MONTHLY_PRICE_ID!);
    expect(mapped).toBe('PRO');
  });
});
