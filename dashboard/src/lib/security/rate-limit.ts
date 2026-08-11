import 'server-only';

import { createHash } from 'node:crypto';
import Redis from 'ioredis';

const state = globalThis as typeof globalThis & { securityRateRedis?: Redis };

function client() {
  if (!process.env.REDIS_URL) throw new Error('Redis is unavailable.');
  if (!state.securityRateRedis) {
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    state.securityRateRedis = redis;
  }
  return state.securityRateRedis;
}

export function securityIdentifier(value: string) {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export function requestNetworkIdentifier(request: Request) {
  if (process.env.SECURITY_TRUST_PROXY_HEADERS === 'true') {
    const forwarded = request.headers
      .get('x-forwarded-for')
      ?.split(',')[0]
      ?.trim();
    const real = request.headers.get('x-real-ip')?.trim();
    if (forwarded || real)
      return securityIdentifier(forwarded || real || 'unknown');
  }
  return securityIdentifier('direct-client');
}

export async function consumeSecurityLimit(input: {
  namespace: string;
  subject: string;
  limit: number;
  windowMs?: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? 60_000;
  const bucket = Math.floor(now / windowMs);
  const redis = client();
  if (redis.status === 'wait') await redis.connect();
  const key = `security:${input.namespace}:${input.subject}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, windowMs);
  return {
    allowed: count <= input.limit,
    retryAfter: Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)),
  };
}

export function closeSecurityRateLimitClient() {
  const redis = state.securityRateRedis;
  delete state.securityRateRedis;
  redis?.disconnect();
}
