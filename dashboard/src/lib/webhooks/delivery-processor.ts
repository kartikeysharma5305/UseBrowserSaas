import { performance } from 'node:perf_hooks';
import { UnrecoverableError, type Job } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { canonicalJson, revealSigningSecret, signWebhookBody } from './crypto';
import { getWebhookConfiguration } from './config';
import { webhookDeliveryJobSchema, type WebhookDeliveryJob } from './job';
import { assertWebhookTarget } from './network';

type WebhookRequest = (input: {
  url: string;
  eventId: string;
  timestamp: number;
  signature: string;
  body: string;
  timeoutMs: number;
  responseLimit: number;
}) => Promise<{ status: number; durationMs: number; oversized: boolean }>;

export async function performWebhookRequest(
  input: Parameters<WebhookRequest>[0]
) {
  const started = performance.now();
  const response = await fetch(input.url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(input.timeoutMs),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'BrowserUse-Outbound-Webhooks/1.0',
      'webhook-id': input.eventId,
      'webhook-timestamp': String(input.timestamp),
      'webhook-signature': input.signature,
    },
    body: input.body,
  });
  let received = 0;
  let oversized = false;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > input.responseLimit) {
        oversized = true;
        await reader.cancel();
        break;
      }
    }
  }
  return {
    status: response.status,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    oversized,
  };
}

export function classifyWebhookResponse(status: number, oversized: boolean) {
  if (oversized)
    return { success: false, retry: false, code: 'RESPONSE_TOO_LARGE' };
  if (status >= 200 && status < 300)
    return { success: true, retry: false, code: null };
  if (status >= 300 && status < 400)
    return { success: false, retry: false, code: 'REDIRECT_BLOCKED' };
  if (status === 408 || status === 429 || status >= 500)
    return { success: false, retry: true, code: 'RETRYABLE_HTTP_STATUS' };
  return { success: false, retry: false, code: 'PERMANENT_HTTP_STATUS' };
}

export class WebhookDeliveryProcessor {
  constructor(
    private readonly request: WebhookRequest = performWebhookRequest
  ) {}

  async process(job: Job<WebhookDeliveryJob>) {
    const parsed = webhookDeliveryJobSchema.safeParse(job.data);
    if (!parsed.success)
      throw new UnrecoverableError('Invalid webhook delivery payload.');
    const config = getWebhookConfiguration();
    const now = new Date();
    const delivery = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.data.deliveryId}, 0))`;
      const current = await transaction.webhookDelivery.findUnique({
        where: { id: parsed.data.deliveryId },
        include: {
          event: true,
          endpoint: {
            include: {
              user: {
                select: { accountDeletion: { select: { status: true } } },
              },
            },
          },
        },
      });
      if (
        !current ||
        ['DELIVERED', 'FAILED', 'SUPPRESSED'].includes(current.status)
      )
        return null;
      if (
        current.endpoint.status !== 'ENABLED' ||
        ['PENDING', 'FAILED'].includes(
          current.endpoint.user.accountDeletion?.status ?? ''
        )
      ) {
        await transaction.webhookDelivery.update({
          where: { id: current.id },
          data: {
            status: 'SUPPRESSED',
            processingLeaseUntil: null,
            failureCode: 'ENDPOINT_UNAVAILABLE',
          },
        });
        return null;
      }
      if (
        current.status === 'PROCESSING' &&
        current.processingLeaseUntil &&
        current.processingLeaseUntil > now
      )
        return null;
      return transaction.webhookDelivery.update({
        where: { id: current.id },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          processingLeaseUntil: new Date(now.getTime() + config.leaseMs),
          firstAttemptAt: current.firstAttemptAt ?? now,
          lastAttemptAt: now,
          failureCode: null,
        },
        include: { event: true, endpoint: true },
      });
    });
    if (!delivery) return;

    let result: Awaited<ReturnType<WebhookRequest>> | null = null;
    let failureCode: string | null = null;
    let retry = false;
    try {
      const url = await assertWebhookTarget(delivery.endpoint.url);
      const body = canonicalJson(delivery.event.payload);
      if (Buffer.byteLength(body) > config.payloadLimitBytes)
        throw new UnrecoverableError(
          'Webhook payload exceeded its safe bound.'
        );
      const timestamp = Math.floor(Date.now() / 1_000);
      const secret = revealSigningSecret(delivery.endpoint);
      const signature = signWebhookBody({
        secret,
        eventId: delivery.event.id,
        timestamp,
        rawBody: body,
      });
      const response = await this.request({
        url,
        eventId: delivery.event.id,
        timestamp,
        signature,
        body,
        timeoutMs: config.requestTimeoutMs,
        responseLimit: config.responseBodyLimitBytes,
      });
      result = response;
      const classified = classifyWebhookResponse(
        response.status,
        response.oversized
      );
      if (classified.success) {
        await prisma.$transaction(async (transaction) => {
          await transaction.webhookDelivery.updateMany({
            where: { id: delivery.id, status: 'PROCESSING' },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
              processingLeaseUntil: null,
              httpStatus: response.status,
              durationMs: response.durationMs,
              failureCode: null,
            },
          });
          await transaction.webhookEndpoint.updateMany({
            where: { id: delivery.endpointId, status: 'ENABLED' },
            data: {
              consecutiveFailures: 0,
              lastSuccessAt: new Date(),
            },
          });
        });
        return;
      }
      failureCode = classified.code;
      retry = classified.retry;
    } catch (error) {
      failureCode =
        error instanceof UnrecoverableError
          ? 'PAYLOAD_INVALID'
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'REQUEST_TIMEOUT'
            : 'NETWORK_OR_TARGET_REJECTED';
      retry = !(error instanceof UnrecoverableError);
    }

    const exhausted = delivery.attemptCount >= config.attempts;
    const endpoint = await prisma.$transaction(async (transaction) => {
      const endpointUpdated = await transaction.webhookEndpoint.updateMany({
        where: { id: delivery.endpointId },
        data: {
          consecutiveFailures: { increment: 1 },
          lastFailureAt: new Date(),
        },
      });
      if (!endpointUpdated.count) return { disabled: true, gone: true };
      const updatedEndpoint = await transaction.webhookEndpoint.findUnique({
        where: { id: delivery.endpointId },
        select: { consecutiveFailures: true },
      });
      if (!updatedEndpoint) return { disabled: true, gone: true };
      const disabled =
        updatedEndpoint.consecutiveFailures >= config.disableThreshold;
      if (disabled) {
        await transaction.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { status: 'DISABLED', disabledAt: new Date() },
        });
        await transaction.webhookDelivery.updateMany({
          where: {
            endpointId: delivery.endpointId,
            id: { not: delivery.id },
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'SUPPRESSED',
            processingLeaseUntil: null,
            failureCode: 'ENDPOINT_AUTO_DISABLED',
          },
        });
      }
      await transaction.webhookDelivery.updateMany({
        where: { id: delivery.id, status: 'PROCESSING' },
        data: {
          status: retry && !exhausted && !disabled ? 'PENDING' : 'FAILED',
          nextAttemptAt: new Date(
            Date.now() +
              config.backoffMs * 2 ** Math.max(0, delivery.attemptCount - 1)
          ),
          processingLeaseUntil: null,
          httpStatus: result?.status ?? null,
          durationMs: result?.durationMs ?? null,
          failureCode,
        },
      });
      return { disabled, gone: false };
    });
    if (endpoint.gone) return;
    if (!retry || exhausted || endpoint.disabled)
      throw new UnrecoverableError('Webhook delivery failed permanently.');
    throw new Error('Webhook delivery will be retried.');
  }
}
