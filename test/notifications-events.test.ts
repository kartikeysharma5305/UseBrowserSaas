import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    schedule: { findUnique: vi.fn() },
    subscription: { findUnique: vi.fn() },
  },
  emit: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/notifications/service', () => ({
  emitNotification: mocks.emit,
  createNotificationRecord: mocks.create,
}));

import {
  createRunTerminalNotification,
  createUsageThresholdNotifications,
  emitBillingAlerts,
  emitScheduleAlert,
} from '@/lib/notifications/events';

describe('Phase 7 authoritative event integrations', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['FAILED', 'TIMED_OUT', 'CANCELED', 'SUCCESS'] as const)(
    'creates deterministic safe terminal notification for %s',
    async (status) => {
      const transaction = {
        run: {
          findUnique: vi
            .fn()
            .mockResolvedValue({
              lastFailureCode: 'PUBLIC_CATEGORY',
              agent: { name: 'Agent' },
            }),
        },
      };
      await createRunTerminalNotification(transaction as never, {
        userId: 'user-1',
        runId: 'run-1',
        status,
        recordedAt: new Date('2026-08-06T10:00:00Z'),
      });
      expect(mocks.create).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({
          userId: 'user-1',
          runId: 'run-1',
          idempotencyKey: `run:run-1:terminal:${status}`,
          payload: expect.not.objectContaining({
            task: expect.anything(),
            result: expect.anything(),
            url: expect.anything(),
          }),
        })
      );
    }
  );

  it('uses period and threshold identities for monthly usage reset safety', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue({ planCode: 'PRO' }) },
      usageRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 450n } }),
      },
      runArtifact: { aggregate: vi.fn() },
    };
    await createUsageThresholdNotifications(transaction as never, {
      userId: 'user-1',
      metric: 'runs',
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-09-01T00:00:00Z'),
    });
    expect(mocks.create).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        idempotencyKey: 'runs:user-1:2026-08-01T00:00:00.000Z:80',
      })
    );
  });

  it('deduplicates schedule alert identities by schedule, reason, and UTC day', async () => {
    mocks.prisma.schedule.findUnique.mockResolvedValue({
      userId: 'user-1',
      agent: { name: 'Agent' },
    });
    await emitScheduleAlert({
      scheduleId: 'schedule-1',
      occurrenceId: 'one',
      status: 'QUOTA_BLOCKED',
      occurredAt: new Date('2026-08-06T01:00:00Z'),
    });
    await emitScheduleAlert({
      scheduleId: 'schedule-1',
      occurrenceId: 'two',
      status: 'QUOTA_BLOCKED',
      occurredAt: new Date('2026-08-06T23:00:00Z'),
    });
    expect(mocks.emit.mock.calls[0][0].idempotencyKey).toBe(
      mocks.emit.mock.calls[1][0].idempotencyKey
    );
  });

  it('uses Stripe event identity and excludes provider identifiers from billing payload', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValue({
      id: 'local-subscription',
      userId: 'user-1',
      status: 'PAST_DUE',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(),
      user: { planSource: 'STRIPE' },
    });
    await emitBillingAlerts({
      stripeSubscriptionId: 'sub_secret',
      eventType: 'invoice.payment_failed',
      eventId: 'evt_secret',
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BILLING_PAYMENT_ISSUE',
        idempotencyKey: 'billing:evt_secret:payment-issue',
        payload: { actionPath: '/dashboard/billing' },
      })
    );
    expect(JSON.stringify(mocks.emit.mock.calls[0][0].payload)).not.toContain(
      'sub_secret'
    );
  });

  it('never emits Stripe-derived alerts for INTERNAL users', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValue({
      id: 'local-subscription',
      userId: 'user-1',
      status: 'CANCELED',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      user: { planSource: 'INTERNAL' },
    });
    await emitBillingAlerts({
      stripeSubscriptionId: 'sub_1',
      eventType: 'customer.subscription.deleted',
      eventId: 'evt_1',
    });
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
