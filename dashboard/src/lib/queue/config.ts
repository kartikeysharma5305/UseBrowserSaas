import type { ConnectionOptions, JobsOptions } from 'bullmq';

const DEFAULTS = {
  queueName: 'browser-agent-runs',
  concurrency: 1,
  attempts: 3,
  backoffMs: 2_000,
  heartbeatMs: 5_000,
  leaseMs: 20_000,
  shutdownGraceMs: 30_000,
  workerHealthHeartbeatMs: 15_000,
  browserShutdownMs: 5_000,
  maxWaiting: 100,
} as const;

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`
    );
  }
  return value;
}

export interface QueueConfiguration {
  queueName: string;
  connection: ConnectionOptions;
  workerConnection: ConnectionOptions;
  concurrency: number;
  attempts: number;
  backoffMs: number;
  heartbeatMs: number;
  leaseMs: number;
  shutdownGraceMs: number;
  workerHealthHeartbeatMs: number;
  browserShutdownMs: number;
  maxWaiting: number;
}

export function getQueueConfiguration(): QueueConfiguration {
  const rawUrl = process.env.REDIS_URL;
  if (!rawUrl) throw new Error('REDIS_URL is required for execution queueing.');

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://.');
  }
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new Error('REDIS_URL database index must be a non-negative integer.');
  }

  const heartbeatMs = integerEnvironment(
    'EXECUTION_QUEUE_HEARTBEAT_MS',
    DEFAULTS.heartbeatMs,
    1_000,
    60_000
  );
  const leaseMs = integerEnvironment(
    'EXECUTION_QUEUE_LEASE_MS',
    DEFAULTS.leaseMs,
    3_000,
    300_000
  );
  if (heartbeatMs >= leaseMs) {
    throw new Error(
      'EXECUTION_QUEUE_HEARTBEAT_MS must be less than the lease.'
    );
  }

  const baseConnection: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(database > 0 ? { db: database } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };

  return {
    queueName: process.env.EXECUTION_QUEUE_NAME?.trim() || DEFAULTS.queueName,
    connection: {
      ...baseConnection,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) =>
        attempt > 3 ? null : Math.min(attempt * 100, 500),
    },
    workerConnection: {
      ...baseConnection,
      maxRetriesPerRequest: null,
    },
    concurrency: integerEnvironment(
      process.env.BROWSER_WORKER_CONCURRENCY
        ? 'BROWSER_WORKER_CONCURRENCY'
        : 'EXECUTION_QUEUE_CONCURRENCY',
      DEFAULTS.concurrency,
      1,
      10
    ),
    attempts: integerEnvironment(
      'EXECUTION_QUEUE_ATTEMPTS',
      DEFAULTS.attempts,
      1,
      10
    ),
    backoffMs: integerEnvironment(
      'EXECUTION_QUEUE_BACKOFF_MS',
      DEFAULTS.backoffMs,
      100,
      60_000
    ),
    heartbeatMs,
    leaseMs,
    shutdownGraceMs: integerEnvironment(
      process.env.WORKER_DRAIN_TIMEOUT_MS
        ? 'WORKER_DRAIN_TIMEOUT_MS'
        : 'EXECUTION_QUEUE_SHUTDOWN_GRACE_MS',
      DEFAULTS.shutdownGraceMs,
      1_000,
      300_000
    ),
    workerHealthHeartbeatMs: integerEnvironment(
      'WORKER_HEALTH_HEARTBEAT_MS',
      DEFAULTS.workerHealthHeartbeatMs,
      5_000,
      60_000
    ),
    browserShutdownMs: integerEnvironment(
      'BROWSER_SHUTDOWN_TIMEOUT_MS',
      DEFAULTS.browserShutdownMs,
      1_000,
      30_000
    ),
    maxWaiting: integerEnvironment(
      'EXECUTION_QUEUE_MAX_WAITING',
      DEFAULTS.maxWaiting,
      1,
      10_000
    ),
  };
}

export function getRunJobOptions(
  configuration: QueueConfiguration
): JobsOptions {
  return {
    attempts: configuration.attempts,
    backoff: { type: 'exponential', delay: configuration.backoffMs },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  };
}
