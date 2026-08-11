import { randomUUID } from 'node:crypto';

import { Worker } from 'bullmq';

import {
  BrowserExecutionService,
  type BrowserExecutionInput,
} from '../src/lib/browser/engine';
import { PrismaRunPersistence } from '../src/lib/browser/run-persistence';
import { prisma } from '../src/lib/db/prisma';
import { ExecutionServiceError } from '../src/lib/execution/errors';
import type { AgentExecutionResult } from '../src/lib/execution/types';
import { getQueueConfiguration } from '../src/lib/queue/config';
import { BrowserRunProcessor } from '../src/lib/worker/browser-run-processor';
import { drainBrowserWorker } from '../src/lib/worker/worker-drain';

const mode = process.env.PHASE4_CONTROLLED_WORKER_MODE;
if (mode !== 'hold' && mode !== 'success' && mode !== 'delay-success') {
  throw new Error(
    'PHASE4_CONTROLLED_WORKER_MODE must be hold, success, or delay-success for this test-only worker.'
  );
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('The controlled Phase 4 worker is disabled in production.');
}

class ControlledExecution extends BrowserExecutionService {
  private readonly controlledPersistence = new PrismaRunPersistence();

  override async execute(
    input: BrowserExecutionInput
  ): Promise<AgentExecutionResult> {
    if (mode === 'hold') {
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener(
          'abort',
          () =>
            reject(
              new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
                stage: 'worker_shutdown',
                runId: input.runId,
              })
            ),
          { once: true }
        );
      });
    }
    const runId = input.runId;
    if (!runId) throw new Error('Controlled worker requires a Run ID.');
    const startedAt = input.startedAt ?? new Date();
    if (mode === 'delay-success') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 8_000);
        input.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(
              new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
                stage: 'heartbeat',
                runId,
              })
            );
          },
          { once: true }
        );
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await this.controlledPersistence.finalizeRun({
      runId,
      startedAt,
      status: 'SUCCESS',
      result: {
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        summary: 'Controlled worker recovery completed.',
        visitedUrls: ['https://example.com/'],
      },
      events: [],
      artifacts: [],
    });
    const completedAt = new Date();
    return {
      runId,
      status: 'completed',
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      summary: 'Controlled worker recovery completed.',
      visitedUrls: ['https://example.com/'],
      eventCount: 1,
      artifactCount: 0,
      detailsUrl: `/dashboard/runs/${runId}`,
    };
  }
}

const configuration = getQueueConfiguration();
const workerId = `phase4-controlled-${process.pid}-${randomUUID()}`;
const processor = new BrowserRunProcessor(
  workerId,
  configuration,
  new ControlledExecution()
);
const worker = new Worker(
  configuration.queueName,
  (job) => processor.process(job),
  {
    connection: configuration.workerConnection,
    concurrency: 1,
    lockDuration: 8_000,
    stalledInterval: 1_000,
    maxStalledCount: 1,
  }
);
await worker.waitUntilReady();
console.info(JSON.stringify({ ready: true, mode, workerId }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  await drainBrowserWorker({
    worker,
    activeCount: () => processor.activeCount,
    abortActive: () => processor.abortAll(),
    drainTimeoutMs: configuration.shutdownGraceMs,
    cleanupTimeoutMs: configuration.browserShutdownMs,
  });
  await prisma.$disconnect();
  console.info(JSON.stringify({ shutdown: true, signal }));
  if (process.connected) process.disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('message', (message) => {
  if (message === 'browser-worker:shutdown') void shutdown('IPC');
});
