import { getQueueConfiguration } from '@/lib/queue/config';

function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

export function getWebhookConfiguration() {
  const queue = getQueueConfiguration();
  return {
    queueName:
      process.env.WEBHOOK_QUEUE_NAME?.trim() || 'outbound-webhook-deliveries',
    connection: queue.connection,
    workerConnection: queue.workerConnection,
    concurrency: integer('WEBHOOK_QUEUE_CONCURRENCY', 4, 1, 20),
    attempts: integer('WEBHOOK_DELIVERY_ATTEMPTS', 6, 1, 8),
    backoffMs: integer('WEBHOOK_DELIVERY_BACKOFF_MS', 2_000, 250, 300_000),
    leaseMs: integer('WEBHOOK_DELIVERY_LEASE_MS', 30_000, 5_000, 300_000),
    requestTimeoutMs: integer(
      'WEBHOOK_REQUEST_TIMEOUT_MS',
      10_000,
      1_000,
      30_000
    ),
    responseBodyLimitBytes: integer(
      'WEBHOOK_RESPONSE_BODY_LIMIT_BYTES',
      65_536,
      1_024,
      262_144
    ),
    payloadLimitBytes: 32_768,
    disableThreshold: integer('WEBHOOK_DISABLE_THRESHOLD', 6, 2, 20),
  };
}
