import Redis from 'ioredis';
import type { PlanCode } from '@prisma/client';

import { getPlan } from '@/lib/plans/catalogue';

export type PublicRateClass = 'general' | 'run-create' | 'cancel' | 'retrieval';
const globalState = globalThis as typeof globalThis & {
  publicApiRedis?: Redis;
};

function client() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Redis is unavailable.');
  if (!globalState.publicApiRedis) {
    const redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    globalState.publicApiRedis = redis;
  }
  return globalState.publicApiRedis;
}

function operationLimit(planCode: PlanCode, kind: PublicRateClass) {
  const limits = getPlan(planCode).limits;
  if (kind === 'run-create') return limits.apiRunCreatesPerMinute;
  if (kind === 'cancel') return limits.apiCancellationsPerMinute;
  if (kind === 'retrieval') return limits.apiRetrievalsPerMinute;
  return limits.apiKeyRequestsPerMinute;
}

async function increment(key: string) {
  const redis = client();
  if (redis.status === 'wait') await redis.connect();
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, 60_000);
  return count;
}

export async function checkPublicApiRateLimit(input: {
  keyId: string;
  userId: string;
  planCode: PlanCode;
  kind: PublicRateClass;
}): Promise<{ allowed: boolean; retryAfter: number; unavailable?: boolean }> {
  const bucket = Math.floor(Date.now() / 60_000);
  const plan = getPlan(input.planCode).limits;
  try {
    const keyCount = await increment(`public-api:key:${input.keyId}:${bucket}`);
    const userCount = await increment(
      `public-api:user:${input.userId}:${bucket}`
    );
    const operationCount = await increment(
      `public-api:op:${input.keyId}:${input.kind}:${bucket}`
    );
    return {
      allowed:
        keyCount <= plan.apiKeyRequestsPerMinute &&
        userCount <= plan.apiUserRequestsPerMinute &&
        operationCount <= operationLimit(input.planCode, input.kind),
      retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60),
    };
  } catch {
    return {
      allowed: input.kind === 'general',
      retryAfter: 5,
      unavailable: true,
    };
  }
}

export async function closePublicApiRateLimitClient() {
  const redis = globalState.publicApiRedis;
  delete globalState.publicApiRedis;
  if (redis) redis.disconnect();
}
