import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    notificationDelivery: { update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));

import { NotificationDeliveryProcessor } from '@/lib/notifications/delivery-processor';

const notification = {
  type: 'RUN_FAILED',
  payload: { agentName: 'Safe agent', actionPath: '/dashboard/runs/run-1' },
  idempotencyKey: 'run:run-1:terminal:FAILED',
};

function job() {
  return { data: { version: 1, deliveryId: 'delivery-1' } } as never;
}

describe('Phase 7 delivery processing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER = 'development';
    process.env.EMAIL_FROM = 'notify@example.test';
    process.env.APP_BASE_URL = 'http://localhost:3001';
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('marks a successful provider send exactly once', async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ messageId: 'provider-safe-id' }),
    };
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: vi.fn(),
        notificationDelivery: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'delivery-1',
            status: 'PENDING',
            processingLeaseUntil: null,
          }),
          update: vi.fn().mockResolvedValue({
            id: 'delivery-1',
            recipientEmail: 'owner@example.test',
            attemptCount: 1,
            notification,
          }),
        },
      })
    );
    await new NotificationDeliveryProcessor(provider).process(job());
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          providerMessageId: 'provider-safe-id',
        }),
      })
    );
  });

  it('does not send completed or concurrently leased deliveries', async () => {
    const provider = { send: vi.fn() };
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: vi.fn(),
        notificationDelivery: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'delivery-1', status: 'SENT' }),
          update: vi.fn(),
        },
      })
    );
    await new NotificationDeliveryProcessor(provider).process(job());
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('returns a failed send to bounded retry without persisting provider detail', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new Error('secret provider response')),
    };
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: vi.fn(),
        notificationDelivery: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'delivery-1', status: 'PENDING' }),
          update: vi.fn().mockResolvedValue({
            id: 'delivery-1',
            recipientEmail: 'owner@example.test',
            attemptCount: 1,
            notification,
          }),
        },
      })
    );
    await expect(
      new NotificationDeliveryProcessor(provider).process(job())
    ).rejects.toThrow('retried');
    const update =
      mocks.prisma.notificationDelivery.update.mock.calls.at(-1)?.[0];
    expect(update.data).toMatchObject({
      status: 'PENDING',
      failureCode: 'EMAIL_DELIVERY_FAILED',
      failureMessage: 'Email delivery failed safely.',
    });
    expect(JSON.stringify(update)).not.toContain('secret provider response');
  });

  it('marks the final bounded attempt terminally failed', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new Error('provider detail')),
    };
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: vi.fn(),
        notificationDelivery: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'delivery-1', status: 'PENDING' }),
          update: vi.fn().mockResolvedValue({
            id: 'delivery-1',
            recipientEmail: 'owner@example.test',
            attemptCount: 5,
            notification,
          }),
        },
      })
    );
    await expect(
      new NotificationDeliveryProcessor(provider).process(job())
    ).rejects.toThrow('exhausted');
    expect(mocks.prisma.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });
});
