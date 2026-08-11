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
const redisHost = await redis.getHost();
const redisPort = await redis.getPort();
const nonce = randomUUID();
process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
process.env.EXECUTION_QUEUE_NAME = `phase4-redis-interruption-${nonce}`;
process.env.EXECUTION_QUEUE_ATTEMPTS = '3';
process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '1000';
process.env.EXECUTION_QUEUE_LEASE_MS = '5000';
process.env.MAX_CONCURRENT_RUNS_PER_USER = '5';

const configuration = getQueueConfiguration();
const queue = new Queue(configuration.queueName, {
  connection: configuration.workerConnection,
});
let worker: ChildProcess | undefined;
let userId: string | undefined;

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
  }) => boolean,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { status: true, attempt: true, heartbeatAt: true },
    });
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Redis interruption drill timed out.');
}

try {
  const user = await prisma.user.create({
    data: {
      email: `phase4-redis-${nonce}@example.invalid`,
      name: 'Phase 4 Redis interruption',
    },
  });
  userId = user.id;
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 4 Redis interruption',
      goal: 'Controlled Redis interruption',
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
  const tsx = path.join(
    dashboardRoot,
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs'
  );
  worker = spawn(
    process.execPath,
    [tsx, 'scripts/controlled-phase4-worker.ts'],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PHASE4_CONTROLLED_WORKER_MODE: 'delay-success',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  worker.stdout?.resume();
  worker.stderr?.resume();

  const running = await waitForRun(
    submitted.runId,
    (run) => run.status === 'RUNNING' && run.heartbeatAt !== null
  );
  const heartbeatBefore = running.heartbeatAt!;
  const interruptionStarted = Date.now();
  await redis.stop();
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const duringOutage = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  const heartbeatContinued =
    duringOutage.status === 'RUNNING' &&
    duringOutage.heartbeatAt !== null &&
    duringOutage.heartbeatAt > heartbeatBefore;
  await redis.start();
  const interruptionMs = Date.now() - interruptionStarted;
  await waitForRun(submitted.runId, (run) => run.status === 'SUCCESS', 60_000);
  const completed = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
    include: { events: true },
  });
  const terminalEventCount = completed.events.filter(
    (event) => event.type === 'RUN_COMPLETED' || event.type === 'RUN_FAILED'
  ).length;
  if (
    !heartbeatContinued ||
    completed.attempt !== 1 ||
    terminalEventCount !== 1
  ) {
    throw new Error('Redis interruption assertions failed.');
  }
  console.info(
    JSON.stringify({
      interruptionMs,
      heartbeatContinued,
      executionContinued: true,
      finalStatus: completed.status,
      attempt: completed.attempt,
      terminalEventCount,
      duplicateExecution: false,
      redisDataPersistence:
        'not asserted because the isolated in-memory Redis process was restarted',
    })
  );
} finally {
  await forceStop(worker);
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.stop().catch(() => undefined);
}
