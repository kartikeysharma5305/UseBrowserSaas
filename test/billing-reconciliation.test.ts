import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    subscription: { findMany: vi.fn() },
    billingWebhookEvent: { findMany: vi.fn() },
    user: { findMany: vi.fn(), update: vi.fn() },
  },
  retrieve: vi.fn(),
  list: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/billing/config', () => ({
  getBillingConfig: () => ({ enabled: true }),
}));
vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: mocks.retrieve, list: mocks.list },
  }),
}));
vi.mock('@/lib/billing/price-catalogue', () => ({
  planCodeForStripePrice: (id: string) => (id === 'price-pro' ? 'PRO' : null),
}));
vi.mock('@/lib/billing/entitlement-sync', () => ({
  syncStripeSubscription: mocks.sync,
}));

import { reconcileBilling } from '../dashboard/src/lib/billing/reconciliation.js';

const local = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-private-12345678',
  stripeSubscriptionId: 'sub_private_12345678',
  stripeCustomerId: 'cus_private_12345678',
  stripePriceId: 'price-pro',
  status: 'ACTIVE',
  currentPeriodEnd: new Date(Date.now() + 86_400_000),
  updatedAt: new Date(),
  user: {
    id: 'user-private-12345678',
    planCode: 'PRO',
    planSource: 'STRIPE',
    stripeCustomerId: 'cus_private_12345678',
  },
  ...overrides,
});

const remote = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_private_12345678',
  customer: 'cus_private_12345678',
  status: 'active',
  created: 1,
  items: { data: [{ price: { id: 'price-pro' } }] },
  ...overrides,
});

describe('billing reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.subscription.findMany.mockResolvedValue([local()]);
    mocks.prisma.billingWebhookEvent.findMany.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.retrieve.mockResolvedValue(remote());
    mocks.list.mockResolvedValue({ data: [] });
  });

  it('is dry-run by default and performs no mutation', async () => {
    mocks.retrieve.mockResolvedValue(remote({ status: 'canceled' }));
    const result = await reconcileBilling();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'STATUS_MISMATCH'
    );
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('repairs a mismatch once and repeated apply is idempotent', async () => {
    mocks.retrieve.mockResolvedValue(remote({ status: 'canceled' }));
    await reconcileBilling({ apply: true });
    expect(mocks.sync).toHaveBeenCalledOnce();
    mocks.prisma.subscription.findMany.mockResolvedValue([
      local({
        status: 'CANCELED',
        user: { ...local().user, planCode: 'FREE' },
      }),
    ]);
    mocks.sync.mockClear();
    const repeated = await reconcileBilling({ apply: true });
    expect(repeated.repaired).toBe(0);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('reports unknown prices and never applies them', async () => {
    mocks.retrieve.mockResolvedValue(
      remote({ items: { data: [{ price: { id: 'price-unknown' } }] } })
    );
    const result = await reconcileBilling({ apply: true });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'UNKNOWN_STRIPE_PRICE'
    );
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('reports failed webhook events', async () => {
    mocks.prisma.billingWebhookEvent.findMany.mockResolvedValue([
      {
        id: 'evt_private_12345678',
        processingState: 'FAILED',
        receivedAt: new Date(),
      },
    ]);
    const result = await reconcileBilling();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'FAILED_WEBHOOK'
    );
  });

  it('protects INTERNAL and redacts complete identifiers', async () => {
    mocks.prisma.subscription.findMany.mockResolvedValue([
      local({
        user: { ...local().user, planCode: 'INTERNAL', planSource: 'INTERNAL' },
      }),
    ]);
    const result = await reconcileBilling({ apply: true });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'INTERNAL_PROTECTED'
    );
    const output = JSON.stringify(result);
    expect(output).not.toContain('user-private-12345678');
    expect(output).not.toContain('sub_private_12345678');
    expect(output).not.toContain('cus_private_12345678');
  });
});
