import Redis from 'ioredis';

import { prisma } from '@/lib/db/prisma';
import { getQueueConfiguration } from '@/lib/queue/config';

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: { database: 'ok' | 'unavailable'; redis: 'ok' | 'unavailable' };
}

export async function checkReadiness(input?: {
  database?: () => Promise<unknown>;
  redis?: () => Promise<unknown>;
}): Promise<ReadinessResult> {
  const database =
    input?.database ?? (() => prisma.$queryRaw`SELECT 1` as Promise<unknown>);
  const redis =
    input?.redis ??
    (async () => {
      getQueueConfiguration();
      const client = new Redis(process.env.REDIS_URL!, {
        lazyConnect: true,
        connectTimeout: 1_500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      try {
        await client.connect();
        await client.ping();
      } finally {
        client.disconnect();
      }
    });
  const [databaseResult, redisResult] = await Promise.allSettled([
    database(),
    redis(),
  ]);
  const checks = {
    database:
      databaseResult.status === 'fulfilled'
        ? ('ok' as const)
        : ('unavailable' as const),
    redis:
      redisResult.status === 'fulfilled'
        ? ('ok' as const)
        : ('unavailable' as const),
  };
  return {
    status:
      checks.database === 'ok' && checks.redis === 'ok' ? 'ready' : 'not_ready',
    checks,
  };
}
