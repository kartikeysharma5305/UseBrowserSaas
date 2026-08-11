import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { createArtifactStorage } from '@/lib/browser/artifact-storage-factory';
import { cancelOwnedRun } from '@/lib/runs/run-cancellation';
import { getBillingConfig } from '@/lib/billing/config';
import { getStripeClient } from '@/lib/billing/stripe-client';
import {
  createNotificationRecord,
  emitNotification,
} from '@/lib/notifications/service';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import {
  removeWebhookJobs,
  removeWebhookJobsForUser,
} from '@/lib/webhooks/queue';

const CONFIRMATION = 'DELETE';

export class AccountDeletionConfirmationError extends Error {}

export async function requestAccountDeletion(
  userId: string,
  confirmation: string
) {
  if (confirmation !== CONFIRMATION)
    throw new AccountDeletionConfirmationError(
      'Confirmation phrase is required.'
    );
  const operation = await prisma.$transaction(async (transaction) => {
    const deletion = await transaction.accountDeletion.upsert({
      where: { userId },
      create: { userId, status: 'PENDING', stage: 'REQUESTED' },
      update: { status: 'PENDING', errorCode: null, lastError: null },
    });
    await transaction.apiKey.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const webhookDeliveries = await transaction.webhookDelivery.findMany({
      where: { endpoint: { userId } },
      select: { id: true },
      take: 1_000,
    });
    await transaction.webhookEndpoint.updateMany({
      where: { userId, status: 'ENABLED' },
      data: { status: 'DISABLED', disabledAt: new Date() },
    });
    await transaction.webhookDelivery.updateMany({
      where: {
        endpoint: { userId },
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status: 'SUPPRESSED',
        processingLeaseUntil: null,
        failureCode: 'ACCOUNT_DELETION',
      },
    });
    // Endpoint deletion immediately destroys recoverable signing material and
    // cascades delivery rows. Immutable product data is already irreversibly
    // entering deletion, so stale BullMQ jobs can only resolve to no-ops.
    await transaction.webhookEndpoint.deleteMany({ where: { userId } });
    return {
      deletion,
      webhookDeliveryIds: webhookDeliveries.map((item) => item.id),
    };
  });
  await removeWebhookJobs(operation.webhookDeliveryIds).catch(() => undefined);
  return processAccountDeletion(operation.deletion.id, userId);
}

export async function getAccountDeletionStatus(userId: string) {
  return prisma.accountDeletion.findUnique({
    where: { userId },
    select: { status: true, stage: true, completedAt: true },
  });
}

export async function isAccountDeletionPending(userId: string) {
  try {
    await removeWebhookJobsForUser(userId).catch(() => undefined);
    const item = await prisma.accountDeletion.findUnique({
      where: { userId },
      select: { status: true },
    });
    return item?.status === 'PENDING' || item?.status === 'FAILED';
  } catch (error: any) {
    // This only preserves normal admission during a rolling deployment where the
    // additive deletion migration has not reached every test/development DB.
    // Production startup still validates migration status before serving traffic.
    if (error?.code === 'P2021') return false;
    throw error;
  }
}

async function processAccountDeletion(id: string, userId: string) {
  const recipient = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  await prisma.accountDeletion.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      stage: 'CANCELING_RUNS',
      status: 'PENDING',
    },
  });
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.scheduledOccurrence.updateMany({
        where: {
          schedule: { userId },
          status: 'DISCOVERED',
          runId: null,
        },
        data: {
          status: 'CANCELED',
          resolvedAt: new Date(),
          processingLeaseUntil: null,
          errorCode: 'ACCOUNT_DELETION',
        },
      });
      await transaction.schedule.updateMany({
        where: { userId, state: { not: 'COMPLETED' } },
        data: { state: 'PAUSED', nextRunAt: null, version: { increment: 1 } },
      });
    });
    const runs = await prisma.run.findMany({
      where: { agent: { userId }, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    for (const run of runs)
      await cancelOwnedRun(run.id, userId, 'Account deletion requested');
    if (runs.length)
      return await prisma.accountDeletion.findUniqueOrThrow({ where: { id } });

    await prisma.accountDeletion.update({
      where: { id },
      data: { stage: 'DELETING_ARTIFACTS' },
    });
    const artifacts = await prisma.runArtifact.findMany({
      where: { run: { agent: { userId } } },
      select: { id: true, storageKey: true, storageProvider: true },
    });
    for (const artifact of artifacts) {
      await createArtifactStorage(artifact.storageProvider).delete(
        artifact.storageKey
      );
      await prisma.runArtifact.delete({ where: { id: artifact.id } });
    }

    await prisma.accountDeletion.update({
      where: { id },
      data: { stage: 'CANCELING_SUBSCRIPTION' },
    });
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { stripeSubscriptionId: true },
    });
    if (subscription && getBillingConfig().enabled) {
      try {
        await getStripeClient().subscriptions.cancel(
          subscription.stripeSubscriptionId
        );
        await prisma.subscription.updateMany({
          where: { userId },
          data: {
            status: 'CANCELED',
            cancelAtPeriodEnd: false,
            canceledAt: new Date(),
          },
        });
      } catch (error: any) {
        if (error?.code !== 'resource_missing') throw error;
      }
    }
    await prisma.accountDeletion.update({
      where: { id },
      data: {
        canceledSubscription: Boolean(subscription),
        stage: 'DELETING_PRODUCT_DATA',
      },
    });
    await prisma.betaFeedback.deleteMany({ where: { userId } });
    await prisma.agent.deleteMany({ where: { userId } });
    await prisma.onboardingState.deleteMany({ where: { userId } });
    await prisma.webhookEndpoint.deleteMany({ where: { userId } });
    await prisma.webhookEvent.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.accountDeletion.update({
      where: { id },
      data: { stage: 'INVALIDATING_SESSIONS' },
    });
    // Make the tombstone and durable completion visible atomically. A late
    // Stripe cancellation webhook must never race this boundary and restore
    // the customer mapping that deletion just removed.
    const completed = await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: { betaAccessStatus: 'ENDED', betaEndedAt: new Date() },
      });
      const deletion = await transaction.accountDeletion.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          stage: 'COMPLETED',
          completedAt: new Date(),
          errorCode: null,
          lastError: null,
        },
      });
      await createNotificationRecord(transaction, {
        userId,
        type: 'ACCOUNT_DELETION_COMPLETED',
        idempotencyKey: `account-deletion:${id}:completed`,
        accountDeletionId: id,
        recipientEmail: recipient.email,
        mandatory: true,
        payload: { completedAt: deletion.completedAt?.toISOString() ?? null },
      });
      await transaction.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@invalid.local`,
          name: null,
          image: null,
          stripeCustomerId: null,
          planCode: 'FREE',
          planSource: 'DEFAULT',
        },
      });
      return deletion;
    });
    await enqueuePendingNotificationDeliveries().catch(() => undefined);
    return completed;
  } catch (error) {
    await prisma.accountDeletion.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: 'ACCOUNT_DELETION_FAILED',
        lastError: 'A deletion dependency failed. Retry is required.',
      },
    });
    await emitNotification({
      userId,
      type: 'ACCOUNT_DELETION_BLOCKED',
      idempotencyKey: `account-deletion:${id}:blocked`,
      accountDeletionId: id,
      recipientEmail: recipient.email,
      mandatory: true,
      payload: { actionPath: '/dashboard/settings' },
    }).catch(() => undefined);
    throw error;
  }
}
