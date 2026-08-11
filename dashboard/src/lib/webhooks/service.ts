import { randomUUID } from 'node:crypto';
import type { Prisma, WebhookEndpoint } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getPlan } from '@/lib/plans/catalogue';
import { generateSigningSecret, protectSigningSecret } from './crypto';
import { createWebhookEventRecord } from './events';
import { assertWebhookTarget } from './network';
import { enqueueWebhookDelivery } from './queue';
import type { WebhookEventType } from './types';

export class WebhookNotFoundError extends Error {}
export class WebhookPlanError extends Error {}
export class WebhookAccountBlockedError extends Error {}

function publicEndpoint(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    status: endpoint.status,
    eventTypes: endpoint.eventTypes,
    secretPrefix: endpoint.secretPrefix,
    secretVersion: endpoint.secretVersion,
    consecutiveFailures: endpoint.consecutiveFailures,
    disabledAt: endpoint.disabledAt?.toISOString() ?? null,
    lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: endpoint.lastFailureAt?.toISOString() ?? null,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

async function assertUserCanManage(
  transaction: Prisma.TransactionClient,
  userId: string
) {
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { planCode: true, accountDeletion: { select: { status: true } } },
  });
  if (
    !user ||
    ['PENDING', 'FAILED'].includes(user.accountDeletion?.status ?? '')
  )
    throw new WebhookAccountBlockedError();
  const limit = getPlan(user.planCode).limits.maxWebhookEndpoints;
  if (!limit) throw new WebhookPlanError();
  return { user, limit };
}

export async function listWebhookEndpoints(userId: string) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return endpoints.map(publicEndpoint);
}

export async function getWebhookEndpoint(userId: string, id: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id, userId },
  });
  return endpoint ? publicEndpoint(endpoint) : null;
}

export async function createWebhookEndpoint(
  userId: string,
  input: { name: string; url: string; eventTypes: WebhookEventType[] }
) {
  const normalizedUrl = await assertWebhookTarget(input.url);
  const secret = generateSigningSecret();
  const protectedSecret = protectSigningSecret(secret);
  const endpoint = await prisma.$transaction(async (transaction) => {
    const { limit } = await assertUserCanManage(transaction, userId);
    const count = await transaction.webhookEndpoint.count({
      where: { userId },
    });
    if (count >= limit) throw new WebhookPlanError();
    return transaction.webhookEndpoint.create({
      data: {
        userId,
        name: input.name,
        url: normalizedUrl,
        eventTypes: input.eventTypes,
        ...protectedSecret,
      },
    });
  });
  return { ...publicEndpoint(endpoint), secret };
}

export async function updateWebhookEndpoint(
  userId: string,
  id: string,
  input: {
    name?: string;
    url?: string;
    eventTypes?: WebhookEventType[];
    enabled?: boolean;
  }
) {
  const url = input.url ? await assertWebhookTarget(input.url) : undefined;
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook:${id}`}, 0))`;
    await assertUserCanManage(transaction, userId);
    const current = await transaction.webhookEndpoint.findFirst({
      where: { id, userId },
    });
    if (!current) throw new WebhookNotFoundError();
    const endpoint = await transaction.webhookEndpoint.update({
      where: { id },
      data: {
        name: input.name,
        url,
        eventTypes: input.eventTypes,
        ...(input.enabled === undefined
          ? {}
          : {
              status: input.enabled ? 'ENABLED' : 'DISABLED',
              disabledAt: input.enabled ? null : new Date(),
              consecutiveFailures: input.enabled ? 0 : undefined,
            }),
      },
    });
    if (input.enabled === false)
      await transaction.webhookDelivery.updateMany({
        where: { endpointId: id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'SUPPRESSED',
          processingLeaseUntil: null,
          failureCode: 'ENDPOINT_DISABLED',
        },
      });
    return publicEndpoint(endpoint);
  });
}

export async function deleteWebhookEndpoint(userId: string, id: string) {
  const result = await prisma.webhookEndpoint.deleteMany({
    where: { id, userId },
  });
  return result.count === 1;
}

export async function rotateWebhookSecret(userId: string, id: string) {
  const secret = generateSigningSecret();
  const protectedSecret = protectSigningSecret(secret);
  const updated = await prisma.$transaction(async (transaction) => {
    await assertUserCanManage(transaction, userId);
    const endpoint = await transaction.webhookEndpoint.findFirst({
      where: { id, userId },
    });
    if (!endpoint) throw new WebhookNotFoundError();
    return transaction.webhookEndpoint.update({
      where: { id },
      data: { ...protectedSecret, secretVersion: { increment: 1 } },
    });
  });
  return { ...publicEndpoint(updated), secret };
}

export async function createTestDelivery(userId: string, endpointId: string) {
  const result = await prisma.$transaction(async (transaction) => {
    await assertUserCanManage(transaction, userId);
    const endpoint = await transaction.webhookEndpoint.findFirst({
      where: { id: endpointId, userId, status: 'ENABLED' },
    });
    if (!endpoint) throw new WebhookNotFoundError();
    return createWebhookEventRecord(transaction, {
      userId,
      type: 'endpoint.test',
      endpointId,
      idempotencyKey: `endpoint-test:${endpointId}:${randomUUID()}`,
      data: { endpointId, test: true },
    });
  });
  const delivery = await prisma.webhookDelivery.findFirstOrThrow({
    where: { eventId: result!.eventId, endpointId },
    orderBy: { sequence: 'desc' },
  });
  await enqueueWebhookDelivery(delivery.id);
  return { eventId: result!.eventId, deliveryId: delivery.id };
}

export async function replayWebhookDelivery(
  userId: string,
  deliveryId: string
) {
  const delivery = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook-delivery:${deliveryId}`}, 0))`;
    await assertUserCanManage(transaction, userId);
    const original = await transaction.webhookDelivery.findFirst({
      where: {
        id: deliveryId,
        endpoint: { userId, status: 'ENABLED' },
        event: { userId },
      },
      select: { eventId: true, endpointId: true },
    });
    if (!original) throw new WebhookNotFoundError();
    const maximum = await transaction.webhookDelivery.aggregate({
      where: { eventId: original.eventId, endpointId: original.endpointId },
      _max: { sequence: true },
    });
    return transaction.webhookDelivery.create({
      data: {
        eventId: original.eventId,
        endpointId: original.endpointId,
        sequence: (maximum._max.sequence ?? 0) + 1,
      },
    });
  });
  await enqueueWebhookDelivery(delivery.id);
  return { eventId: delivery.eventId, deliveryId: delivery.id };
}

export async function listWebhookDeliveries(
  userId: string,
  endpointId: string,
  limit: number
) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, userId },
    select: { id: true },
  });
  if (!endpoint) throw new WebhookNotFoundError();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId },
    include: { event: { select: { id: true, type: true, createdAt: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(100, Math.max(1, limit)),
  });
  return deliveries.map((delivery) => ({
    id: delivery.id,
    eventId: delivery.event.id,
    eventType: delivery.event.type,
    eventCreatedAt: delivery.event.createdAt.toISOString(),
    sequence: delivery.sequence,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    httpStatus: delivery.httpStatus,
    failureCode: delivery.failureCode,
    durationMs: delivery.durationMs,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
  }));
}
