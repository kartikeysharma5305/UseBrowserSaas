import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, mockStripeClient } = vi.hoisted(() => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    billingWebhookEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    accountDeletion: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const mockStripeClient = {
    customers: {
      create: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
  };
  return { mockPrisma, mockStripeClient };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: vi.fn(() => mockStripeClient),
  classifyStripeError: vi.fn((error) => 'STRIPE_ERROR'),
}));

import { getOrCreateStripeCustomerForUser } from '@/lib/billing/customer';
import {
  syncStripeSubscription,
  UnknownStripePriceError,
} from '@/lib/billing/entitlement-sync';
import { handleStripeWebhookEvent } from '@/lib/billing/webhook';

beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_billing';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_billing';
  process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_123';
  process.env.STRIPE_CHECKOUT_SUCCESS_URL =
    'http://localhost:3001/dashboard/billing?checkout=success';
  process.env.STRIPE_CHECKOUT_CANCEL_URL =
    'http://localhost:3001/dashboard/billing?checkout=canceled';
  process.env.STRIPE_PORTAL_RETURN_URL =
    'http://localhost:3001/dashboard/billing';
  vi.resetAllMocks();
  mockPrisma.user.findUnique.mockReset();
  mockPrisma.user.findFirst.mockReset();
  mockPrisma.user.update.mockReset();
  mockPrisma.subscription.findUnique.mockReset();
  mockPrisma.subscription.upsert.mockReset();
  mockPrisma.subscription.updateMany.mockReset();
  mockPrisma.billingWebhookEvent.create.mockReset();
  mockPrisma.billingWebhookEvent.findUnique.mockReset();
  mockPrisma.billingWebhookEvent.updateMany.mockReset();
  mockPrisma.billingWebhookEvent.update.mockReset();
  mockPrisma.accountDeletion.findUnique.mockReset();
  mockPrisma.$transaction.mockReset();
  mockStripeClient.customers.create.mockReset();
  mockStripeClient.subscriptions.retrieve.mockReset();
});

describe('billing webhook event claiming', () => {
  const unsupportedEvent = {
    id: 'evt_unsupported',
    type: 'customer.created',
    created: 1,
    data: { object: {} },
  } as any;

  it('records and acknowledges an unsupported event once', async () => {
    mockPrisma.billingWebhookEvent.create.mockResolvedValue({});
    mockPrisma.billingWebhookEvent.update.mockResolvedValue({});
    await handleStripeWebhookEvent(unsupportedEvent);
    expect(mockPrisma.billingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'evt_unsupported',
          processingState: 'PROCESSING',
        }),
      })
    );
    expect(mockPrisma.billingWebhookEvent.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingState: 'PROCESSED' }),
      })
    );
  });

  it('skips an already processed duplicate', async () => {
    mockPrisma.billingWebhookEvent.create.mockRejectedValue(
      new Error('unique')
    );
    mockPrisma.billingWebhookEvent.findUnique.mockResolvedValue({
      processingState: 'PROCESSED',
    });
    await handleStripeWebhookEvent(unsupportedEvent);
    expect(mockPrisma.billingWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('reclaims a failed event atomically', async () => {
    mockPrisma.billingWebhookEvent.create.mockRejectedValue(
      new Error('unique')
    );
    mockPrisma.billingWebhookEvent.findUnique.mockResolvedValue({
      processingState: 'FAILED',
    });
    mockPrisma.billingWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.billingWebhookEvent.update.mockResolvedValue({});
    await handleStripeWebhookEvent(unsupportedEvent);
    expect(mockPrisma.billingWebhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt_unsupported', processingState: 'FAILED' },
      })
    );
  });

  it('lets only one simultaneous delivery claim an in-flight event', async () => {
    let releaseFirstCreate: (() => void) | undefined;
    mockPrisma.billingWebhookEvent.create
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstCreate = resolve;
          })
      )
      .mockRejectedValueOnce(new Error('unique'));
    mockPrisma.billingWebhookEvent.findUnique.mockResolvedValue({
      processingState: 'PROCESSING',
    });
    mockPrisma.billingWebhookEvent.update.mockResolvedValue({});

    const first = handleStripeWebhookEvent(unsupportedEvent);
    const second = handleStripeWebhookEvent(unsupportedEvent);
    await Promise.resolve();
    await second;
    expect(mockPrisma.billingWebhookEvent.update).not.toHaveBeenCalled();
    releaseFirstCreate?.();
    await first;
    expect(mockPrisma.billingWebhookEvent.update).toHaveBeenCalledTimes(1);
  });

  it('does not restore a Stripe mapping after account deletion completed', async () => {
    mockPrisma.billingWebhookEvent.create.mockResolvedValue({});
    mockPrisma.billingWebhookEvent.update.mockResolvedValue({});
    mockPrisma.accountDeletion.findUnique.mockResolvedValue({
      status: 'COMPLETED',
    });

    await handleStripeWebhookEvent({
      id: 'evt_deleted_user',
      type: 'customer.subscription.deleted',
      created: 1,
      data: {
        object: {
          id: 'sub_deleted',
          customer: 'cus_deleted',
          metadata: { internalUserId: 'user-deleted' },
        },
      },
    } as any);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.billingWebhookEvent.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingState: 'PROCESSED' }),
      })
    );
  });
});

describe('billing customer service', () => {
  it('returns an existing Stripe customer ID when present', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      stripeCustomerId: 'cus_existing',
    });

    const result = await getOrCreateStripeCustomerForUser('user-1');

    expect(result).toBe('cus_existing');
    expect(mockStripeClient.customers.create).not.toHaveBeenCalled();
  });

  it('creates a new Stripe customer when none exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      stripeCustomerId: null,
    });
    mockStripeClient.customers.create.mockResolvedValue({ id: 'cus_new' });
    mockPrisma.user.update.mockResolvedValue({ stripeCustomerId: 'cus_new' });

    const result = await getOrCreateStripeCustomerForUser('user-1');

    expect(result).toBe('cus_new');
    expect(mockStripeClient.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' }),
      expect.objectContaining({
        idempotencyKey: 'billing-create-stripe-customer-user-1',
      })
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    );
  });
});

describe('billing subscription entitlement sync', () => {
  it('syncs an active Stripe subscription and updates the user to PRO', async () => {
    const stripeSubscription = {
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      items: {
        data: [
          {
            price: {
              id: 'price_123',
            },
            current_period_start: 1700000000,
            current_period_end: 1700003600,
          },
        ],
      },
      cancel_at_period_end: false,
      canceled_at: null,
      trial_end: null,
      metadata: {},
    };

    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      planCode: 'FREE',
      planSource: 'DEFAULT',
      stripeCustomerId: 'cus_123',
    });

    const tx = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          planCode: 'FREE',
          planSource: 'DEFAULT',
          stripeCustomerId: 'cus_123',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(tx)
    );

    await syncStripeSubscription(stripeSubscription as any, {
      stripeEventId: 'evt_123',
      stripeEventCreatedAt: new Date('2025-01-01T00:00:00Z'),
    });

    expect(tx.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_123' },
      })
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          planCode: 'PRO',
          planSource: 'STRIPE',
        }),
      })
    );
  });

  it('persists FREE state then surfaces unknown Stripe prices for reconciliation', async () => {
    const tx = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          planCode: 'FREE',
          planSource: 'DEFAULT',
          stripeCustomerId: 'cus_123',
        }),
        update: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(tx)
    );

    await expect(
      syncStripeSubscription(
        {
          id: 'sub_unknown',
          customer: 'cus_123',
          status: 'active',
          items: {
            data: [
              {
                price: { id: 'price_unknown' },
                current_period_start: 1,
                current_period_end: 2,
              },
            ],
          },
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
        } as any,
        { stripeEventId: 'evt_unknown', stripeEventCreatedAt: new Date() }
      )
    ).rejects.toBeInstanceOf(UnknownStripePriceError);

    expect(tx.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ planCode: 'FREE' }),
      })
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planCode: 'FREE',
          planSource: 'DEFAULT',
        }),
      })
    );
  });

  it('ignores stale subscription snapshots without mutating the user', async () => {
    const tx = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          lastStripeEventCreatedAt: new Date('2026-08-04T00:00:00Z'),
        }),
        upsert: vi.fn(),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          planCode: 'PRO',
          planSource: 'STRIPE',
          stripeCustomerId: 'cus_123',
        }),
        update: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(tx)
    );
    await syncStripeSubscription(
      {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        items: {
          data: [
            {
              price: { id: 'price_123' },
              current_period_start: 1,
              current_period_end: 2,
            },
          ],
        },
        cancel_at_period_end: false,
        canceled_at: 2,
        trial_end: null,
      } as any,
      {
        stripeEventId: 'evt_old',
        stripeEventCreatedAt: new Date('2026-08-03T00:00:00Z'),
      }
    );
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('records Stripe state without overwriting an INTERNAL entitlement', async () => {
    const tx = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          planCode: 'INTERNAL',
          planSource: 'INTERNAL',
          stripeCustomerId: 'cus_123',
        }),
        update: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(tx)
    );
    await syncStripeSubscription(
      {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        items: {
          data: [
            {
              price: { id: 'price_123' },
              current_period_start: 1,
              current_period_end: 2,
            },
          ],
        },
        cancel_at_period_end: false,
        canceled_at: null,
        trial_end: null,
      } as any,
      { stripeEventId: 'evt_internal', stripeEventCreatedAt: new Date() }
    );
    expect(tx.subscription.upsert).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planCode: 'INTERNAL',
          planSource: 'INTERNAL',
        }),
      })
    );
  });
});
