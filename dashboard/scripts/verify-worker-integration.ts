import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Worker } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import { EngineLoader } from '../src/lib/browser/engine-loader';
import { prisma } from '../src/lib/db/prisma';
import { closeBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { BrowserRunProcessor } from '../src/lib/worker/browser-run-processor';

const redis = await RedisMemoryServer.create();
const artifactRoot = await mkdtemp(path.join(tmpdir(), 'browser-run-worker-'));
const nonce = randomUUID();
process.env.REDIS_URL = `redis://${await redis.getHost()}:${await redis.getPort()}`;
process.env.EXECUTION_QUEUE_NAME = `browser-worker-verification-${nonce}`;
process.env.ARTIFACT_STORAGE_ROOT = artifactRoot;
process.env.EXECUTION_QUEUE_ATTEMPTS = '1';
process.env.BROWSER_USE_LOGGING_LEVEL = 'error';

const configuration = getQueueConfiguration();
const workerId = `verification-${nonce}`;
const processor = new BrowserRunProcessor(workerId, configuration);
let worker: Worker | undefined;
let userId: string | undefined;

try {
  await new EngineLoader().loadEngineModules();
  const user = await prisma.user.create({
    data: {
      email: `phase4-${nonce}@example.invalid`,
      name: 'Phase 4 verification',
    },
  });
  userId = user.id;
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 4 example.com verification',
      goal: 'Open the page and report its title.',
      targetWebsite: 'https://example.com',
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps: 4,
        timeoutMs: 60_000,
        browserSettings: {
          headless: true,
          viewportWidth: 1280,
          viewportHeight: 720,
          useVision: false,
        },
      },
    },
  });

  const producer = new PrismaRunProducer();
  const submissionStartedAt = Date.now();
  const submitted = await producer.enqueue({
    agentId: agent.id,
    userId,
  });
  const submissionMs = Date.now() - submissionStartedAt;
  const queuedBeforeWorker = await prisma.run.findFirst({
    where: { id: submitted.runId, status: 'QUEUED', attempt: 0 },
    select: { id: true },
  });
  if (!queuedBeforeWorker) {
    throw new Error('Run was not durably queued before worker startup.');
  }

  const activeWorker = new Worker(
    configuration.queueName,
    (job) => processor.process(job),
    { connection: configuration.workerConnection, concurrency: 1 }
  );
  worker = activeWorker;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Worker integration timed out.')),
      120_000
    );
    activeWorker.on('completed', (job) => {
      if (job.data.runId !== submitted.runId) return;
      clearTimeout(timer);
      resolve();
    });
    activeWorker.on('failed', (job, error) => {
      if (job?.data.runId !== submitted.runId) return;
      clearTimeout(timer);
      reject(error);
    });
  });

  const run = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
    include: { events: true, artifacts: true },
  });
  if (run.status !== 'SUCCESS') {
    throw new Error(`Worker integration ended with ${run.status}.`);
  }
  console.info(
    JSON.stringify({
      status: run.status,
      attempt: run.attempt,
      eventCount: run.events.length,
      artifactCount: run.artifacts.length,
      queuedBeforeWorker: true,
      submissionMs,
      leaseReleased:
        run.workerId === null &&
        run.heartbeatAt === null &&
        run.leaseExpiresAt === null,
    })
  );
} finally {
  processor.abortAll();
  await worker?.close();
  await closeBrowserRunQueue();
  if (userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
  await redis.stop();
  await rm(artifactRoot, { recursive: true, force: true });
}
