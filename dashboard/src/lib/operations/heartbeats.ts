import Redis from 'ioredis';

export const OPERATIONAL_COMPONENTS = [
  'scheduler',
  'notification-worker',
  'webhook-worker',
] as const;
export type OperationalComponent = (typeof OPERATIONAL_COMPONENTS)[number];

const state = globalThis as typeof globalThis & { operationsRedis?: Redis };

function client() {
  if (!process.env.REDIS_URL) throw new Error('Redis is unavailable.');
  state.operationsRedis ??= new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  state.operationsRedis.on('error', () => undefined);
  return state.operationsRedis;
}

export async function recordOperationalHeartbeat(
  component: OperationalComponent,
  now = new Date()
) {
  try {
    const redis = client();
    if (redis.status === 'wait') await redis.connect();
    await redis.set(
      `operations:heartbeat:${component}`,
      now.toISOString(),
      'EX',
      120
    );
    return true;
  } catch {
    return false;
  }
}

export async function readOperationalHeartbeats() {
  try {
    const redis = client();
    if (redis.status === 'wait') await redis.connect();
    const values = await redis.mget(
      ...OPERATIONAL_COMPONENTS.map(
        (component) => `operations:heartbeat:${component}`
      )
    );
    return Object.fromEntries(
      OPERATIONAL_COMPONENTS.map((component, index) => [
        component,
        values[index] ?? null,
      ])
    ) as Record<OperationalComponent, string | null>;
  } catch {
    return Object.fromEntries(
      OPERATIONAL_COMPONENTS.map((component) => [component, null])
    ) as Record<OperationalComponent, string | null>;
  }
}

export function closeOperationsRedis() {
  const redis = state.operationsRedis;
  delete state.operationsRedis;
  redis?.disconnect();
}
