import { randomUUID } from 'node:crypto';

import { Worker } from 'bullmq';

import { BrowserExecutionService } from '../src/lib/browser/engine';
import { prisma } from '../src/lib/db/prisma';
import {
  ExecutionServiceError,
  safeSerializeError,
} from '../src/lib/execution/errors';
import { logger } from '../src/lib/logger';
import { getQueueConfiguration } from '../src/lib/queue/config';
import { BrowserRunProcessor } from '../src/lib/worker/browser-run-processor';

if (
  process.platform !== 'linux' ||
  process.env.NODE_ENV === 'production' ||
  !process.env.PHASE4_FAIL_FIRST_RUN_ID
) {
  throw new Error(
    'The Phase 4 fail-first worker requires Linux, non-production mode, and a target Run ID.'
  );
}

const configuration = getQueueConfiguration();
const targetRunId = process.env.PHASE4_FAIL_FIRST_RUN_ID;
const failedRuns = new Set<string>();

class FailFirstBrowserExecutionService extends BrowserExecutionService {
  override async execute(
    input: Parameters<BrowserExecutionService['execute']>[0]
  ) {
    if (input.runId === targetRunId && !failedRuns.has(targetRunId)) {
      failedRuns.add(targetRunId);
      throw new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
        stage: 'browser_start',
        runId: targetRunId,
        cause: new Error('Controlled Linux browser-start failure.'),
      });
    }
    return super.execute(input);
  }
}

const workerId = `${process.pid}-${randomUUID()}`;
const processor = new BrowserRunProcessor(
  workerId,
  configuration,
  new FailFirstBrowserExecutionService()
);
const worker = new Worker(
  configuration.queueName,
  (job) => processor.process(job),
  {
    connection: configuration.workerConnection,
    concurrency: 1,
  }
);

worker.on('failed', (job, error) => {
  logger.warn('Phase 4 fail-first attempt observed', {
    runId: job?.data.runId,
    attempt: job?.attemptsMade,
    error: safeSerializeError(error),
  });
});

await worker.waitUntilReady();
logger.info('Phase 4 fail-first worker ready', { workerId });

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
