import { getQueueConfiguration } from '@/lib/queue/config';

function enabled(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

export function getEmailConfiguration() {
  const isEnabled = enabled('EMAIL_ENABLED');
  const provider =
    process.env.EMAIL_PROVIDER?.trim().toLowerCase() || 'development';
  if (!['development', 'resend'].includes(provider))
    throw new Error('EMAIL_PROVIDER must be development or resend.');
  if (!isEnabled)
    return {
      enabled: false as const,
      provider: provider as 'development' | 'resend',
      from: null,
      apiKey: null,
      appBaseUrl: null,
    };
  const from = process.env.EMAIL_FROM?.trim();
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const rawBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!from || !from.includes('@'))
    throw new Error('EMAIL_FROM is required when email is enabled.');
  if (!rawBaseUrl)
    throw new Error('APP_BASE_URL is required when email is enabled.');
  const appBaseUrl = new URL(rawBaseUrl);
  if (!['http:', 'https:'].includes(appBaseUrl.protocol))
    throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
  if (provider === 'resend' && !apiKey)
    throw new Error('EMAIL_API_KEY is required for the Resend provider.');
  return {
    enabled: true as const,
    provider: provider as 'development' | 'resend',
    from,
    apiKey: apiKey ?? null,
    appBaseUrl: appBaseUrl.origin,
  };
}

export function getNotificationQueueConfiguration() {
  const queue = getQueueConfiguration();
  return {
    queueName:
      process.env.NOTIFICATION_QUEUE_NAME?.trim() || 'notification-deliveries',
    connection: queue.connection,
    workerConnection: queue.workerConnection,
    concurrency: integer('NOTIFICATION_QUEUE_CONCURRENCY', 3, 1, 20),
    attempts: integer('NOTIFICATION_QUEUE_ATTEMPTS', 5, 1, 10),
    backoffMs: integer('NOTIFICATION_QUEUE_BACKOFF_MS', 5_000, 500, 300_000),
    leaseMs: integer('NOTIFICATION_DELIVERY_LEASE_MS', 60_000, 5_000, 600_000),
  };
}
