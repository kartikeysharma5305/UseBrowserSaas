import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { Queue } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import { prisma } from '../src/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { closeBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';

const execFileAsync = promisify(execFile);
const dashboardRoot = path.resolve(import.meta.dirname, '..');
const redis = await RedisMemoryServer.create();
const nonce = randomUUID();
process.env.REDIS_URL = `redis://${await redis.getHost()}:${await redis.getPort()}`;
process.env.EXECUTION_QUEUE_NAME = `phase4-crash-${nonce}`;
process.env.EXECUTION_QUEUE_ATTEMPTS = '3';
process.env.EXECUTION_QUEUE_BACKOFF_MS = '100';
process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '1000';
process.env.EXECUTION_QUEUE_LEASE_MS = '5000';
process.env.MAX_CONCURRENT_RUNS_PER_USER = '5';

const configuration = getQueueConfiguration();
const queue = new Queue(configuration.queueName, {
  connection: configuration.workerConnection,
});
let firstWorker: ChildProcess | undefined;
let secondWorker: ChildProcess | undefined;
let userId: string | undefined;

function startWorker(mode: 'hold' | 'success') {
  const tsx = path.join(
    dashboardRoot,
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs'
  );
  const child = spawn(
    process.execPath,
    [tsx, 'scripts/controlled-phase4-worker.ts'],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PHASE4_CONTROLLED_WORKER_MODE: mode,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

async function forceStop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || !child.pid) return;
  await execFileAsync('taskkill.exe', [
    '/PID',
    String(child.pid),
    '/T',
    '/F',
  ]).catch(() => undefined);
}

async function waitForRun(
  runId: string,
  predicate: (run: {
    status: string;
    attempt: number;
    heartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
  }) => boolean,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: {
        status: true,
        attempt: true,
        heartbeatAt: true,
        leaseExpiresAt: true,
      },
    });
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Worker recovery drill timed out.');
}

try {
  const user = await prisma.user.create({
    data: {
      email: `phase4-crash-${nonce}@example.invalid`,
      name: 'Phase 4 crash recovery',
    },
  });
  userId = user.id;
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 4 crash recovery',
      goal: 'Controlled crash recovery',
      targetWebsite: 'https://example.com',
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps: 4,
        timeoutMs: 60_000,
        browserSettings: {
          headless: true,
          viewportWidth: 1280,
          viewportHeight: 720,
        },
      },
    },
  });
  const submitted = await new PrismaRunProducer().enqueue({
    agentId: agent.id,
    userId,
  });

  firstWorker = startWorker('hold');
  const claimed = await waitForRun(
    submitted.runId,
    (run) =>
      run.status === 'RUNNING' &&
      run.attempt === 1 &&
      run.heartbeatAt !== null &&
      run.leaseExpiresAt !== null
  );
  const heartbeatBeforeCrash = claimed.heartbeatAt;
  const leaseExpiry = claimed.leaseExpiresAt!;
  await forceStop(firstWorker);
  firstWorker = undefined;

  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const beforeExpiry = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  const noPrematureClaim =
    beforeExpiry.status === 'RUNNING' &&
    beforeExpiry.attempt === 1 &&
    beforeExpiry.heartbeatAt?.getTime() === heartbeatBeforeCrash?.getTime() &&
    Date.now() < leaseExpiry.getTime();

  secondWorker = startWorker('success');
  await waitForRun(submitted.runId, (run) => run.status === 'SUCCESS', 60_000);
  const completed = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
  const sequences = completed.events.map((event) => event.sequence);
  const terminalEvents = completed.events.filter(
    (event) => event.type === 'RUN_COMPLETED' || event.type === 'RUN_FAILED'
  );
  const queueJob = await queue.getJob(submitted.runId);
  if (
    !noPrematureClaim ||
    completed.attempt !== 2 ||
    terminalEvents.length !== 1 ||
    new Set(sequences).size !== sequences.length
  ) {
    throw new Error('Killed-worker recovery assertions failed.');
  }
  console.info(
    JSON.stringify({
      termination: 'taskkill /T /F',
      heartbeatStopped: true,
      temporaryStatus: beforeExpiry.status,
      noPrematureClaim,
      leaseExpiredBeforeRecovery: Date.now() >= leaseExpiry.getTime(),
      recoveredAttempt: completed.attempt,
      finalStatus: completed.status,
      terminalEventCount: terminalEvents.length,
      eventSequenceUnique: new Set(sequences).size === sequences.length,
      artifactCount: completed.artifacts.length,
      bullJobState: await queueJob?.getState(),
    })
  );
} finally {
  await forceStop(firstWorker);
  await forceStop(secondWorker);
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.stop();
}
