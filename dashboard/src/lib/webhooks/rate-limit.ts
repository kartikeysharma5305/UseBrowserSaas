import Redis from 'ioredis';
import type { PlanCode } from '@prisma/client';

import { getPlan } from '@/lib/plans/catalogue';
import { SECURITY_POLICY } from '@/lib/security/policy';

const state = globalThis as typeof globalThis & { webhookRateRedis?: Redis };

function client() {
  if (!process.env.REDIS_URL) throw new Error('Redis is unavailable.');
  if (!state.webhookRateRedis) {
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    state.webhookRateRedis = redis;
  }
  return state.webhookRateRedis;
}

export async function consumeWebhookCommandLimit(
  userId: string,
  planCode: PlanCode,
  kind: 'test' | 'replay'
) {
  const planLimit =
    kind === 'test'
      ? getPlan(planCode).limits.webhookTestsPerMinute
      : getPlan(planCode).limits.webhookReplaysPerMinute;
  const securityLimit =
    kind === 'test'
      ? SECURITY_POLICY.webhookCommands.testPerMinute
      : SECURITY_POLICY.webhookCommands.replayPerMinute;
  const limit = Math.min(planLimit, securityLimit);
  if (limit === 0) return false;
  const redis = client();
  if (redis.status === 'wait') await redis.connect();
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `webhook:${kind}:${userId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, 60_000);
  return count <= limit;
}

export function closeWebhookRateLimitClient() {
  const redis = state.webhookRateRedis;
  delete state.webhookRateRedis;
  redis?.disconnect();
}
