import { randomBytes } from 'node:crypto';
import type {
  Prisma,
  RunStatus,
  ScheduledOccurrenceStatus,
} from '@prisma/client';

import { getPlan } from '@/lib/plans/catalogue';
import { RUN_WEBHOOK_EVENT, type WebhookLogicalEventType } from './types';

function eventId() {
  return `evt_${randomBytes(16).toString('hex')}`;
}

function supportsWebhooks(transaction: Prisma.TransactionClient) {
  return Boolean(
    (transaction as Partial<Prisma.TransactionClient>).webhookEvent &&
    (transaction as Partial<Prisma.TransactionClient>).webhookDelivery
  );
}

export async function createWebhookEventRecord(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    type: WebhookLogicalEventType;
    idempotencyKey: string;
    data: Record<string, string | number | boolean | null>;
    runId?: string;
    scheduleId?: string;
    occurrenceId?: string;
    endpointId?: string;
    createdAt?: Date;
  }
) {
  if (!supportsWebhooks(transaction)) return null;
  const createdAt = input.createdAt ?? new Date();
  const id = eventId();
  const payload = {
    id,
    type: input.type,
    version: 1,
    createdAt: createdAt.toISOString(),
    data: input.data,
  } as Prisma.InputJsonObject;
  const inserted = await transaction.webhookEvent.createMany({
    data: [
      {
        id,
        userId: input.userId,
        type: input.type,
        version: 1,
        payload,
        idempotencyKey: input.idempotencyKey,
        runId: input.runId,
        scheduleId: input.scheduleId,
        occurrenceId: input.occurrenceId,
        createdAt,
      },
    ],
    skipDuplicates: true,
  });
  const event = await transaction.webhookEvent.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (!inserted.count)
    return { eventId: event.id, created: false, deliveries: 0 };
  const user = await transaction.user.findUnique({
    where: { id: input.userId },
    select: { planCode: true, accountDeletion: { select: { status: true } } },
  });
  if (
    !user ||
    ['PENDING', 'FAILED'].includes(user.accountDeletion?.status ?? '') ||
    getPlan(user.planCode).limits.maxWebhookEndpoints === 0
  )
    return { eventId: event.id, created: true, deliveries: 0 };
  const endpoints = await transaction.webhookEndpoint.findMany({
    where: {
      userId: input.userId,
      status: 'ENABLED',
      ...(input.endpointId
        ? { id: input.endpointId }
        : { eventTypes: { has: input.type } }),
    },
    select: { id: true },
  });
  if (endpoints.length)
    await transaction.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        eventId: event.id,
        endpointId: endpoint.id,
      })),
      skipDuplicates: true,
    });
  return { eventId: event.id, created: true, deliveries: endpoints.length };
}

export async function createRunWebhookEvent(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    runId: string;
    status: RunStatus;
    recordedAt?: Date;
  }
) {
  const type = RUN_WEBHOOK_EVENT[input.status];
  if (!type) return null;
  const run = await transaction.run.findUnique({
    where: { id: input.runId },
    select: { id: true, agentId: true },
  });
  if (!run) return null;
  return createWebhookEventRecord(transaction, {
    userId: input.userId,
    type,
    idempotencyKey: `run:${input.runId}:webhook:${type}`,
    runId: input.runId,
    createdAt: input.recordedAt,
    data: { runId: run.id, agentId: run.agentId, status: input.status },
  });
}

const BLOCKED = new Set<ScheduledOccurrenceStatus>([
  'QUOTA_BLOCKED',
  'ACTIVE_LIMIT_BLOCKED',
  'PLAN_BLOCKED',
  'ACCOUNT_BLOCKED',
  'AGENT_BLOCKED',
]);

export async function createScheduleWebhookEvent(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    scheduleId: string;
    occurrenceId: string;
    status: ScheduledOccurrenceStatus;
    runId?: string | null;
    recordedAt?: Date;
  }
) {
  const type =
    input.status === 'ADMITTED'
      ? 'schedule.triggered'
      : BLOCKED.has(input.status)
        ? 'schedule.blocked'
        : input.status === 'FAILED'
          ? 'schedule.failed'
          : null;
  if (!type) return null;
  return createWebhookEventRecord(transaction, {
    userId: input.userId,
    type,
    idempotencyKey: `schedule-occurrence:${input.occurrenceId}:webhook:${type}`,
    scheduleId: input.scheduleId,
    occurrenceId: input.occurrenceId,
    createdAt: input.recordedAt,
    data: {
      scheduleId: input.scheduleId,
      occurrenceId: input.occurrenceId,
      runId: input.runId ?? null,
      status: input.status,
    },
  });
}
