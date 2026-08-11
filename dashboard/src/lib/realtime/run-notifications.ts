import Redis from 'ioredis';
import { z } from 'zod';

import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';

const notificationSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1).max(128),
    kind: z.enum(['changed', 'cancel']),
  })
  .strict();

export type RunNotification = z.infer<typeof notificationSchema>;

export function parseRunNotification(payload: string): RunNotification | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = notificationSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function channelName(): string {
  const queueName =
    process.env.EXECUTION_QUEUE_NAME?.trim() || 'browser-agent-runs';
  return `${queueName}:run-notifications`;
}

function redisUrl(): string {
  const value = process.env.REDIS_URL;
  if (!value) throw new Error('REDIS_URL is required for run notifications.');
  return value;
}

function createRedisConnection(): Redis {
  const connection = new Redis(redisUrl(), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt > 3 ? null : Math.min(attempt * 100, 500),
  });
  connection.on('error', () => {
    // Call sites retain PostgreSQL polling as the durable fallback.
  });
  return connection;
}

const globalPublisher = globalThis as typeof globalThis & {
  runNotificationPublisher?: Redis;
};

async function ready(connection: Redis): Promise<void> {
  if (connection.status === 'wait') {
    await connection.connect();
  }
  if (connection.status !== 'ready') {
    await connection.ping();
  }
}

export async function publishRunNotification(
  runId: string,
  kind: RunNotification['kind'] = 'changed'
): Promise<boolean> {
  try {
    let publisher = globalPublisher.runNotificationPublisher;
    if (!publisher || publisher.status === 'end') {
      publisher = createRedisConnection();
      globalPublisher.runNotificationPublisher = publisher;
    }
    await ready(publisher);
    const receivers = await publisher.publish(
      channelName(),
      JSON.stringify({ version: 1, runId, kind } satisfies RunNotification)
    );
    return receivers > 0;
  } catch (error) {
    logger.warn(
      'Run notification publish failed; database fallback remains active',
      {
        runId,
        kind,
        error: safeSerializeError(error),
      }
    );
    return false;
  }
}

export class RunNotificationSubscriber {
  private connection: Redis | null = null;
  private handler: ((notification: RunNotification) => void) | null = null;

  async start(
    handler: (notification: RunNotification) => void
  ): Promise<boolean> {
    if (this.connection) return true;
    const connection = createRedisConnection();
    this.connection = connection;
    this.handler = handler;
    connection.on('message', (_channel: string, payload: string) => {
      const notification = parseRunNotification(payload);
      if (notification) this.handler?.(notification);
    });
    try {
      await ready(connection);
      await connection.subscribe(channelName());
      return true;
    } catch (error) {
      logger.warn(
        'Run notification subscriber unavailable; database fallback remains active',
        {
          error: safeSerializeError(error),
        }
      );
      await this.close();
      return false;
    }
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.handler = null;
    if (!connection) return;
    connection.removeAllListeners('message');
    try {
      if (connection.status === 'ready') {
        await connection.unsubscribe(channelName());
      }
    } finally {
      connection.disconnect(false);
    }
  }
}
