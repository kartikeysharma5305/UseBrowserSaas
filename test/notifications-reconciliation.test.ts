import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { notificationDelivery: { findMany: mocks.findMany } },
}));

import {
  enqueueNotificationDelivery,
  enqueuePendingNotificationDeliveries,
} from '@/lib/notifications/queue';

describe('Phase 7 delivery reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the durable delivery identity as the deterministic queue job ID', async () => {
    await enqueueNotificationDelivery('delivery-1', {
      add: mocks.add,
    } as never);
    expect(mocks.add).toHaveBeenCalledWith(
      'deliver-email-notification',
      { version: 1, deliveryId: 'delivery-1' },
      { jobId: 'delivery-1' }
    );
  });

  it('re-enqueues bounded pending and expired leased deliveries', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'pending-1' },
      { id: 'expired-1' },
    ]);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    await expect(
      enqueuePendingNotificationDeliveries(10, enqueue)
    ).resolves.toBe(2);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, where: { OR: expect.any(Array) } })
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
