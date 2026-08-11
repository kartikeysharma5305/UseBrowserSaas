import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getBillingConfig: vi.fn(),
  getStripePriceForPlan: vi.fn(),
  getOrCreateStripeCustomerForUser: vi.fn(),
  getStripeCustomerIdForUser: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  userFindUnique: vi.fn(),
  subscriptionFindFirst: vi.fn(),
}));

vi.mock('@/lib/api/route-helpers', () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  jsonError: (error: string, status = 400, code?: string) =>
    NextResponse.json(code ? { error, code } : { error }, { status }),
  parseValidatedBody: async (
    request: Request,
    schema: { safeParse(input: unknown): { success: boolean; data?: unknown } }
  ) => {
    try {
      const parsed = schema.safeParse(await request.json());
      return parsed.success
        ? { ok: true, data: parsed.data }
        : {
            ok: false,
            response: NextResponse.json(
              { error: 'Validation failed.' },
              { status: 400 }
            ),
          };
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Invalid request body.' },
          { status: 400 }
        ),
      };
    }
  },
}));
vi.mock('@/lib/billing/config', () => ({
  getBillingConfig: mocks.getBillingConfig,
}));
vi.mock('@/lib/billing/price-catalogue', () => ({
  getStripePriceForPlan: mocks.getStripePriceForPlan,
}));
vi.mock('@/lib/billing/customer', () => ({
  getOrCreateStripeCustomerForUser: mocks.getOrCreateStripeCustomerForUser,
  getStripeCustomerIdForUser: mocks.getStripeCustomerIdForUser,
}));
vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: mocks.checkoutCreate } },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  }),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    subscription: { findFirst: mocks.subscriptionFindFirst },
  },
}));

import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as portal } from '@/app/api/billing/portal/route';
import { GET as status } from '@/app/api/billing/status/route';

const enabled = {
  enabled: true as const,
  testMode: true,
  proMonthlyPriceId: 'price_pro',
  secretKey: 'sk_test_secret',
  webhookSecret: 'whsec_test',
  checkoutSuccessUrl:
    'http://localhost:3001/dashboard/billing?checkout=success',
  checkoutCancelUrl:
    'http://localhost:3001/dashboard/billing?checkout=canceled',
  portalReturnUrl: 'http://localhost:3001/dashboard/billing',
  appOrigin: 'http://localhost:3001',
  environment: 'test',
};
const user = { id: 'user_1', planCode: 'FREE', planSource: 'DEFAULT' };
const request = (body: unknown) =>
  new NextRequest('http://localhost:3001/api/billing/checkout', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getBillingConfig.mockReturnValue(enabled);
  mocks.requireAuthenticatedUser.mockResolvedValue(user);
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.getStripePriceForPlan.mockReturnValue({ priceId: 'price_pro' });
  mocks.getOrCreateStripeCustomerForUser.mockResolvedValue('cus_trusted');
  mocks.checkoutCreate.mockResolvedValue({
    url: 'https://checkout.stripe.test/session',
  });
  mocks.getStripeCustomerIdForUser.mockResolvedValue('cus_trusted');
  mocks.portalCreate.mockResolvedValue({
    url: 'https://billing.stripe.test/session',
  });
  mocks.userFindUnique.mockResolvedValue({
    planCode: 'FREE',
    planSource: 'DEFAULT',
    stripeCustomerId: null,
  });
});

describe('billing routes', () => {
  it('rejects unauthenticated checkout and portal requests', async () => {
    mocks.requireAuthenticatedUser.mockResolvedValue(null);
    expect((await checkout(request({ plan: 'PRO' }))).status).toBe(401);
    expect((await portal()).status).toBe(401);
  });

  it('returns a safe disabled response before calling Stripe', async () => {
    mocks.getBillingConfig.mockReturnValue({
      enabled: false,
      testMode: true,
      appOrigin: 'http://localhost:3001',
      environment: 'test',
    });
    const response = await checkout(request({ plan: 'PRO' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: 'BILLING_DISABLED' })
    );
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it('validates checkout input and blocks INTERNAL or active subscribers', async () => {
    expect((await checkout(request({ plan: 'FREE' }))).status).toBe(400);
    mocks.requireAuthenticatedUser.mockResolvedValue({
      ...user,
      planSource: 'INTERNAL',
    });
    expect((await checkout(request({ plan: 'PRO' }))).status).toBe(403);
    mocks.requireAuthenticatedUser.mockResolvedValue(user);
    mocks.subscriptionFindFirst.mockResolvedValue({ id: 'sub_existing' });
    expect((await checkout(request({ plan: 'PRO' }))).status).toBe(400);
  });

  it('uses only trusted Checkout inputs and returns only the hosted URL', async () => {
    const response = await checkout(
      request({
        plan: 'PRO',
        priceId: 'price_attack',
        customerId: 'cus_attack',
        userId: 'other',
        successUrl: 'https://evil.example',
      })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: { url: 'https://checkout.stripe.test/session' },
    });
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_trusted',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        success_url: enabled.checkoutSuccessUrl,
        cancel_url: enabled.checkoutCancelUrl,
        subscription_data: {
          metadata: { internalUserId: 'user_1', plan: 'PRO' },
        },
      }),
      expect.anything()
    );
  });

  it('requires an existing trusted customer for the portal and uses configured return URL', async () => {
    mocks.getStripeCustomerIdForUser.mockResolvedValue(null);
    expect((await portal()).status).toBe(400);
    mocks.getStripeCustomerIdForUser.mockResolvedValue('cus_trusted');
    const response = await portal();
    expect(await response.json()).toEqual({
      data: { url: 'https://billing.stripe.test/session' },
    });
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_trusted',
      return_url: enabled.portalReturnUrl,
    });
  });

  it('returns safe status without Stripe identifiers', async () => {
    mocks.userFindUnique.mockResolvedValue({
      planCode: 'PRO',
      planSource: 'STRIPE',
      stripeCustomerId: 'cus_secret',
    });
    mocks.subscriptionFindFirst.mockResolvedValue({
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-08-01'),
      currentPeriodEnd: new Date('2026-09-01'),
      cancelAtPeriodEnd: true,
      canceledAt: null,
      paymentFailureAt: null,
    });
    const response = await status();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      billingEnabled: true,
      planCode: 'PRO',
      actions: { canStartCheckout: false, canOpenPortal: true },
    });
    expect(JSON.stringify(body)).not.toContain('cus_secret');
    expect(JSON.stringify(body)).not.toContain('sk_test_secret');
  });
});
