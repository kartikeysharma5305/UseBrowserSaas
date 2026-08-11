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
process.env.EXECUTION_QUEUE_NAME = `phase4-shutdown-${nonce}`;
process.env.EXECUTION_QUEUE_ATTEMPTS = '3';
process.env.EXECUTION_QUEUE_BACKOFF_MS = '100';
process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '1000';
process.env.EXECUTION_QUEUE_LEASE_MS = '5000';
process.env.WORKER_DRAIN_TIMEOUT_MS = '1000';
process.env.BROWSER_SHUTDOWN_TIMEOUT_MS = '3000';
process.env.MAX_CONCURRENT_RUNS_PER_USER = '5';

const configuration = getQueueConfiguration();
const queue = new Queue(configuration.queueName, {
  connection: configuration.workerConnection,
});
let worker: ChildProcess | undefined;
let replacement: ChildProcess | undefined;
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
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { child, output: () => output };
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

async function waitForStatus(
  runId: string,
  statuses: string[],
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (run && statuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Graceful shutdown drill timed out.');
}

try {
  const user = await prisma.user.create({
    data: {
      email: `phase4-shutdown-${nonce}@example.invalid`,
      name: 'Phase 4 shutdown verification',
    },
  });
  userId = user.id;
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 4 shutdown verification',
      goal: 'Controlled shutdown',
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
  const active = startWorker('hold');
  worker = active.child;
  await waitForStatus(submitted.runId, ['RUNNING']);
  const shutdownStarted = Date.now();
  worker.send('browser-worker:shutdown');
  const exitCode = await Promise.race([
    new Promise<number | null>((resolve) =>
      worker!.once('exit', (code) => resolve(code))
    ),
    new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 10_000)
    ),
  ]);
  const shutdownMs = Date.now() - shutdownStarted;
  const handledSignal = active.output().includes('"shutdown":true');
  const afterShutdown = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  if (
    exitCode === 'timeout' ||
    !handledSignal ||
    afterShutdown.status !== 'QUEUED' ||
    afterShutdown.workerId !== null ||
    afterShutdown.heartbeatAt !== null ||
    afterShutdown.leaseExpiresAt !== null
  ) {
    throw new Error(
      `SIGTERM was not graceful: ${JSON.stringify({
        exitCode,
        handledSignal,
        status: afterShutdown.status,
        shutdownMs,
      })}`
    );
  }
  worker = undefined;
  const next = startWorker('success');
  replacement = next.child;
  const completed = await waitForStatus(submitted.runId, ['SUCCESS']);
  console.info(
    JSON.stringify({
      signal: 'IPC (Windows SIGTERM-equivalent harness)',
      shutdownMs,
      handlerCompleted: handledSignal,
      statusAfterShutdown: afterShutdown.status,
      leaseReleased: true,
      finalStatus: completed.status,
      finalAttempt: completed.attempt,
      duplicateExecution: false,
    })
  );
} finally {
  await forceStop(worker);
  await forceStop(replacement);
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.stop();
}
