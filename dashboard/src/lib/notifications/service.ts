import type { NotificationType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';

import { enqueueNotificationDelivery } from './queue';

export const NOTIFICATION_PREFERENCE_DEFAULTS = {
  emailEnabled: true,
  runSuccess: false,
  runFailure: true,
  runCanceled: false,
  scheduledAlerts: true,
  billingAlerts: true,
  usageAlerts: true,
  accountLifecycle: true,
  dailyDigest: false,
  timezone: 'UTC',
} as const;

export type NotificationPreferenceChanges = {
  emailEnabled?: boolean;
  runSuccess?: boolean;
  runFailure?: boolean;
  runCanceled?: boolean;
  scheduledAlerts?: boolean;
  billingAlerts?: boolean;
  usageAlerts?: boolean;
  accountLifecycle?: boolean;
  dailyDigest?: boolean;
  timezone?: string;
};

type PreferenceKey =
  | 'runSuccess'
  | 'runFailure'
  | 'runCanceled'
  | 'scheduledAlerts'
  | 'billingAlerts'
  | 'usageAlerts'
  | 'accountLifecycle';

const PREFERENCE: Record<NotificationType, PreferenceKey> = {
  RUN_SUCCEEDED: 'runSuccess',
  RUN_FAILED: 'runFailure',
  RUN_TIMED_OUT: 'runFailure',
  RUN_CANCELED: 'runCanceled',
  SCHEDULE_QUOTA_BLOCKED: 'scheduledAlerts',
  SCHEDULE_REPEATED_FAILURE: 'scheduledAlerts',
  USAGE_THRESHOLD: 'usageAlerts',
  STORAGE_THRESHOLD: 'usageAlerts',
  BILLING_PAYMENT_ISSUE: 'billingAlerts',
  SUBSCRIPTION_CANCELING: 'billingAlerts',
  SUBSCRIPTION_ENDED: 'billingAlerts',
  ACCOUNT_DELETION_COMPLETED: 'accountLifecycle',
  ACCOUNT_DELETION_BLOCKED: 'accountLifecycle',
};

const TITLES: Record<NotificationType, string> = {
  RUN_SUCCEEDED: 'Run succeeded',
  RUN_FAILED: 'Run failed',
  RUN_TIMED_OUT: 'Run timed out',
  RUN_CANCELED: 'Run canceled',
  SCHEDULE_QUOTA_BLOCKED: 'Scheduled Run blocked',
  SCHEDULE_REPEATED_FAILURE: 'Schedule needs attention',
  USAGE_THRESHOLD: 'Run usage threshold reached',
  STORAGE_THRESHOLD: 'Storage threshold reached',
  BILLING_PAYMENT_ISSUE: 'Subscription payment issue',
  SUBSCRIPTION_CANCELING: 'Subscription cancellation scheduled',
  SUBSCRIPTION_ENDED: 'Subscription ended',
  ACCOUNT_DELETION_COMPLETED: 'Account deletion completed',
  ACCOUNT_DELETION_BLOCKED: 'Account deletion needs retry',
};

function sanitizePayload(
  payload: Record<string, unknown>
): Prisma.InputJsonObject {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value))
      safe[key] = value;
    else if (typeof value === 'boolean' || value === null) safe[key] = value;
  }
  return safe as Prisma.InputJsonObject;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runId?: string;
  scheduleId?: string;
  subscriptionId?: string;
  accountDeletionId?: string;
  recipientEmail?: string;
  mandatory?: boolean;
}

export async function createNotificationRecord(
  transaction: Prisma.TransactionClient,
  input: CreateNotificationInput
) {
  if (input.idempotencyKey.length > 190)
    throw new Error('Notification idempotency key is too long.');
  const user = await transaction.user.findUnique({
    where: { id: input.userId },
    select: { email: true, notificationPreference: true },
  });
  if (!user) return null;
  const preferences =
    user.notificationPreference ?? NOTIFICATION_PREFERENCE_DEFAULTS;
  const preferred =
    input.mandatory ||
    (preferences.emailEnabled && preferences[PREFERENCE[input.type]]);
  const globallyEnabled =
    process.env.EMAIL_ENABLED?.trim().toLowerCase() === 'true';
  const inserted = await transaction.notification.createMany({
    data: [
      {
        userId: input.userId,
        type: input.type,
        title: TITLES[input.type],
        payload: sanitizePayload(input.payload ?? {}),
        idempotencyKey: input.idempotencyKey,
        runId: input.runId,
        scheduleId: input.scheduleId,
        subscriptionId: input.subscriptionId,
        accountDeletionId: input.accountDeletionId,
      },
    ],
    skipDuplicates: true,
  });
  const notification = await transaction.notification.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (inserted.count === 0)
    return {
      notificationId: notification.id,
      created: false,
      deliveryId: null,
    };
  const delivery = await transaction.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      recipientEmail: (input.recipientEmail ?? user.email).slice(0, 320),
      status: preferred && globallyEnabled ? 'PENDING' : 'SUPPRESSED',
      failureCode: preferred
        ? globallyEnabled
          ? null
          : 'EMAIL_DISABLED'
        : 'PREFERENCE_DISABLED',
    },
    select: { id: true, status: true },
  });
  return {
    notificationId: notification.id,
    created: true,
    deliveryId: delivery.status === 'PENDING' ? delivery.id : null,
  };
}

export async function emitNotification(input: CreateNotificationInput) {
  const result = await prisma.$transaction((transaction) =>
    createNotificationRecord(transaction, input)
  );
  if (result?.deliveryId) {
    try {
      await enqueueNotificationDelivery(result.deliveryId);
    } catch (error) {
      logger.warn('Notification persisted without immediate queue enqueue', {
        notificationId: result.notificationId,
        error: safeSerializeError(error),
      });
    }
  }
  return result;
}

export async function getNotificationPreferences(userId: string) {
  const stored = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  return stored ?? { userId, ...NOTIFICATION_PREFERENCE_DEFAULTS };
}

export async function updateNotificationPreferences(
  userId: string,
  changes: NotificationPreferenceChanges
) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...NOTIFICATION_PREFERENCE_DEFAULTS, ...changes },
    update: changes,
  });
}

export async function listNotifications(
  userId: string,
  input: { limit: number; cursor?: string }
) {
  return prisma.notification.findMany({
    where: { userId },
    take: input.limit,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      type: true,
      title: true,
      payload: true,
      runId: true,
      scheduleId: true,
      createdAt: true,
      readAt: true,
      deliveries: { select: { channel: true, status: true, sentAt: true } },
    },
  });
}

export async function markNotificationRead(userId: string, id: string) {
  const updated = await prisma.notification.updateMany({
    where: { id, userId },
    data: { readAt: new Date() },
  });
  return updated.count === 1;
}

export async function markAllNotificationsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
