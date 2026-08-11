import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { SCHEDULER_POLICY } from '@/lib/scheduling/policy';
import { runSchedulerTick } from '@/lib/scheduling/processor';
import {
  closeOperationsRedis,
  recordOperationalHeartbeat,
} from '@/lib/operations/heartbeats';

const controller = new AbortController();
let stopping = false;

await prisma.$queryRaw`SELECT 1`;
logger.info('Schedule worker ready', {
  pollIntervalMs: SCHEDULER_POLICY.pollIntervalMs,
  batchSize: SCHEDULER_POLICY.batchSize,
});

async function loop() {
  while (!controller.signal.aborted) {
    try {
      const result = await runSchedulerTick();
      await recordOperationalHeartbeat('scheduler');
      if (result.due || result.processed)
        logger.operation('info', {
          component: 'scheduler',
          event: 'tick_completed',
          ...result,
        });
    } catch (error) {
      logger.error('Schedule worker tick failed', {
        error: safeSerializeError(error),
      });
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SCHEDULER_POLICY.pollIntervalMs);
      const stop = () => {
        clearTimeout(timer);
        resolve();
      };
      controller.signal.addEventListener('abort', stop, { once: true });
    });
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  controller.abort();
  logger.info('Schedule worker shutting down', { signal });
  closeOperationsRedis();
  await prisma.$disconnect();
}

async function handleShutdown(signal: string) {
  try {
    await shutdown(signal);
    process.exit(0);
  } catch (error) {
    logger.error('Schedule worker shutdown failed', {
      signal,
      error: safeSerializeError(error),
    });
    process.exit(1);
  }
}

process.once('SIGINT', () => void handleShutdown('SIGINT'));
process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
await loop();
