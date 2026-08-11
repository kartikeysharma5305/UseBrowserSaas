import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    accountDeletion: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    apiKey: { updateMany: vi.fn() },
    webhookEndpoint: { updateMany: vi.fn(), deleteMany: vi.fn() },
    webhookDelivery: { findMany: vi.fn(), updateMany: vi.fn() },
    webhookEvent: { deleteMany: vi.fn() },
    run: { findMany: vi.fn() },
    runArtifact: { findMany: vi.fn(), delete: vi.fn() },
    subscription: { findUnique: vi.fn(), updateMany: vi.fn() },
    schedule: { updateMany: vi.fn() },
    scheduledOccurrence: { updateMany: vi.fn() },
    agent: { deleteMany: vi.fn() },
    betaFeedback: { deleteMany: vi.fn() },
    account: { deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    notification: { createMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    notificationDelivery: { create: vi.fn() },
    onboardingState: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(mocks.prisma)),
  },
  cancelOwnedRun: vi.fn(),
  storageDelete: vi.fn(),
  stripeCancel: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/runs/run-cancellation', () => ({
  cancelOwnedRun: mocks.cancelOwnedRun,
}));
vi.mock('@/lib/browser/artifact-storage-factory', () => ({
  createArtifactStorage: () => ({ delete: mocks.storageDelete }),
}));
vi.mock('@/lib/billing/config', () => ({
  getBillingConfig: () => ({ enabled: true }),
}));
vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: () => ({ subscriptions: { cancel: mocks.stripeCancel } }),
}));
vi.mock('@/lib/notifications/queue', () => ({
  enqueuePendingNotificationDeliveries: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/webhooks/queue', () => ({
  removeWebhookJobs: vi.fn().mockResolvedValue(0),
  removeWebhookJobsForUser: vi.fn().mockResolvedValue(0),
}));

import {
  AccountDeletionConfirmationError,
  isAccountDeletionPending,
  requestAccountDeletion,
} from '../dashboard/src/lib/account-deletion.js';

describe('recoverable account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.accountDeletion.upsert.mockResolvedValue({ id: 'delete-1' });
    mocks.prisma.accountDeletion.update.mockResolvedValue({
      status: 'COMPLETED',
      stage: 'COMPLETED',
    });
    mocks.prisma.apiKey.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webhookEndpoint.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webhookDelivery.findMany.mockResolvedValue([]);
    mocks.prisma.webhookEndpoint.deleteMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webhookEvent.deleteMany.mockResolvedValue({ count: 1 });
    mocks.prisma.run.findMany.mockResolvedValue([]);
    mocks.prisma.runArtifact.findMany.mockResolvedValue([]);
    mocks.prisma.subscription.findUnique.mockResolvedValue(null);
    mocks.prisma.user.findUniqueOrThrow.mockResolvedValue({
      email: 'disposable@example.test',
    });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: 'disposable@example.test',
      notificationPreference: null,
    });
    mocks.prisma.notification.createMany.mockResolvedValue({ count: 1 });
    mocks.prisma.notification.findUniqueOrThrow.mockResolvedValue({
      id: 'notification-1',
    });
    mocks.prisma.notificationDelivery.create.mockResolvedValue({
      id: 'delivery-1',
      status: 'SUPPRESSED',
    });
  });

  it('requires the explicit confirmation phrase', async () => {
    await expect(
      requestAccountDeletion('user-1', 'delete')
    ).rejects.toBeInstanceOf(AccountDeletionConfirmationError);
    expect(mocks.prisma.accountDeletion.upsert).not.toHaveBeenCalled();
  });

  it('creates or resumes one owner-scoped operation and invalidates sessions', async () => {
    await requestAccountDeletion('user-1', 'DELETE');
    expect(mocks.prisma.accountDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
    expect(mocks.prisma.agent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(mocks.prisma.onboardingState.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    );
  });

  it('requests cancellation and stops before destructive cleanup while runs remain', async () => {
    mocks.prisma.run.findMany.mockResolvedValue([
      { id: 'run-1' },
      { id: 'run-2' },
    ]);
    mocks.prisma.accountDeletion.findUniqueOrThrow.mockResolvedValue({
      status: 'PENDING',
    });
    await requestAccountDeletion('user-1', 'DELETE');
    expect(mocks.cancelOwnedRun).toHaveBeenCalledTimes(2);
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(mocks.prisma.agent.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes artifact objects before metadata and cancels without refund', async () => {
    mocks.prisma.runArtifact.findMany.mockResolvedValue([
      { id: 'artifact-1', storageKey: 'owned/key', storageProvider: 'S3' },
    ]);
    mocks.prisma.subscription.findUnique.mockResolvedValue({
      stripeSubscriptionId: 'sub-redacted',
    });
    await requestAccountDeletion('user-1', 'DELETE');
    expect(mocks.storageDelete).toHaveBeenCalledWith('owned/key');
    expect(mocks.storageDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.runArtifact.delete.mock.invocationCallOrder[0]
    );
    expect(mocks.stripeCancel).toHaveBeenCalledOnce();
  });

  it('persists a sanitized retryable failure', async () => {
    mocks.storageDelete.mockRejectedValueOnce(new Error('storage unavailable'));
    mocks.prisma.runArtifact.findMany.mockResolvedValue([
      { id: 'artifact-1', storageKey: 'owned/key', storageProvider: 'LOCAL' },
    ]);
    await expect(requestAccountDeletion('user-1', 'DELETE')).rejects.toThrow();
    expect(mocks.prisma.accountDeletion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: 'ACCOUNT_DELETION_FAILED',
        }),
      })
    );
  });

  it('blocks admissions while the durable operation is pending or failed', async () => {
    mocks.prisma.accountDeletion.findUnique.mockResolvedValue({
      status: 'PENDING',
    });
    await expect(isAccountDeletionPending('user-1')).resolves.toBe(true);
    mocks.prisma.accountDeletion.findUnique.mockResolvedValue({
      status: 'FAILED',
    });
    await expect(isAccountDeletionPending('user-1')).resolves.toBe(true);
    mocks.prisma.accountDeletion.findUnique.mockResolvedValue({
      status: 'COMPLETED',
    });
    await expect(isAccountDeletionPending('user-1')).resolves.toBe(false);
  });
});
