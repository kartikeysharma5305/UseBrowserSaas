import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Queue } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import { prisma } from '../src/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import {
  closeBrowserRunQueue,
  enqueueBrowserRun,
} from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';
import { cancelOwnedRun } from '../src/lib/runs/run-cancellation';
import { runSchedulerTick } from '../src/lib/scheduling/processor';

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const tsx = path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const redis = await RedisMemoryServer.create();
const nonce = randomUUID();
process.env.REDIS_URL = `redis://${await redis.getHost()}:${await redis.getPort()}`;
process.env.EXECUTION_QUEUE_NAME = `phase22-runtime-${nonce}`;
process.env.EXECUTION_QUEUE_ATTEMPTS = '1';
process.env.BROWSER_WORKER_CONCURRENCY = '1';
process.env.WORKER_HEALTH_HEARTBEAT_MS = '5000';
process.env.WORKER_DRAIN_TIMEOUT_MS = '5000';
process.env.BROWSER_SHUTDOWN_TIMEOUT_MS = '3000';
process.env.WORKER_BUILD_VERSION = 'phase22-runtime';
process.env.BROWSER_USE_LOGGING_LEVEL = 'error';

const configuration = getQueueConfiguration();
const queue = new Queue(configuration.queueName, {
  connection: configuration.workerConnection,
});
const workers: ChildProcess[] = [];
let userId: string | undefined;

function startWorker(): ChildProcess {
  const child = spawn(
    process.execPath,
    [tsx, 'src/worker/browser-run-worker.ts'],
    {
      cwd: dashboardRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );
  child.stdout?.resume();
  child.stderr?.resume();
  workers.push(child);
  return child;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

async function stopWorker(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  child.send('browser-worker:shutdown');
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Worker did not drain within the runtime bound.')),
      15_000
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

try {
  const started = [startWorker(), startWorker()];
  await waitFor(
    async () =>
      (await prisma.workerInstance.count({
        where: { buildVersion: 'phase22-runtime', status: 'ACTIVE' },
      })) === 2,
    'Two production browser workers did not become ACTIVE.'
  );

  const user = await prisma.user.create({
    data: {
      email: `phase22-${nonce}@example.invalid`,
      name: 'Phase 22 runtime',
      planCode: 'INTERNAL',
      planSource: 'MANUAL',
    },
  });
  userId = user.id;
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 22 isolated execution',
      goal: 'Open the page, report its title, and finish.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps: 3,
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
  const submitted = await new PrismaRunProducer().enqueue({
    agentId: agent.id,
    userId,
  });

  // Reproduce duplicate delivery pressure. The deterministic BullMQ job ID and
  // PostgreSQL claim are independent safeguards.
  await Promise.all([
    enqueueBrowserRun(queue, submitted.runId),
    enqueueBrowserRun(queue, submitted.runId),
  ]);

  await waitFor(async () => {
    const run = await prisma.run.findUnique({
      where: { id: submitted.runId },
      select: { status: true },
    });
    return Boolean(
      run && ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].includes(run.status)
    );
  }, 'The disposable browser Run did not reach a terminal state.');

  const run = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      usageRecords: { select: { idempotencyKey: true } },
    },
  });
  const startedEvents = run.events.filter(
    (event) => event.type === 'RUN_STARTED'
  );
  const terminalEvents = run.events.filter((event) =>
    ['RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELED'].includes(event.type)
  );
  const usageKeys = run.usageRecords.map((row) => row.idempotencyKey);
  if (
    run.attempt !== 1 ||
    startedEvents.length !== 1 ||
    terminalEvents.length !== 1 ||
    usageKeys.length === 0 ||
    new Set(usageKeys).size !== usageKeys.length
  ) {
    throw new Error('Multi-worker uniqueness or accounting assertions failed.');
  }

  const scheduledAgent = await prisma.agent.create({
    data: {
      userId,
      name: 'Phase 22 scheduled cancellation',
      goal: 'Open the page, then wait before reporting its title.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
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
  const scheduledFor = new Date();
  const schedule = await prisma.schedule.create({
    data: {
      userId,
      agentId: scheduledAgent.id,
      kind: 'ONCE',
      timezone: 'UTC',
      oneTimeAt: scheduledFor,
      nextRunAt: scheduledFor,
    },
  });
  const discoveryTick = await runSchedulerTick(new Date());
  await new Promise((resolve) => setTimeout(resolve, 100));
  const admissionTick = await runSchedulerTick(new Date());
  const occurrence = await prisma.scheduledOccurrence.findFirstOrThrow({
    where: { scheduleId: schedule.id },
    select: { runId: true, status: true, errorCode: true, attempts: true },
  });
  if (!occurrence.runId || occurrence.status !== 'ADMITTED') {
    throw new Error(
      `Scheduler did not admit through the ordinary Run queue: ${JSON.stringify(
        {
          discoveryTick,
          admissionTick,
          occurrence,
        }
      )}`
    );
  }
  await waitFor(
    async () =>
      (
        await prisma.run.findUnique({
          where: { id: occurrence.runId! },
          select: { status: true },
        })
      )?.status === 'RUNNING',
    'Scheduled Run was not claimed by either worker.',
    30_000
  );
  await cancelOwnedRun(
    occurrence.runId,
    userId,
    'Phase 22 controlled cancellation'
  );
  await waitFor(
    async () =>
      (
        await prisma.run.findUnique({
          where: { id: occurrence.runId! },
          select: { status: true },
        })
      )?.status === 'CANCELED',
    'Cancellation did not reach the worker owning the scheduled Run.',
    30_000
  );
  const canceled = await prisma.run.findUniqueOrThrow({
    where: { id: occurrence.runId },
    include: { events: true },
  });

  const exitCodes = await Promise.all(started.map(stopWorker));
  await waitFor(
    async () =>
      (await prisma.workerInstance.count({
        where: { buildVersion: 'phase22-runtime', status: 'STOPPED' },
      })) === 2,
    'Worker health records did not reach STOPPED.',
    20_000
  );
  const job = await queue.getJob(submitted.runId);
  console.info(
    JSON.stringify({
      workerProcesses: 2,
      activeHealthRecords: 2,
      finalStatus: run.status,
      effectiveAttempts: run.attempt,
      startedEvents: startedEvents.length,
      terminalEvents: terminalEvents.length,
      duplicateDeliveryAttempted: true,
      accountingKeysUnique: new Set(usageKeys).size === usageKeys.length,
      accountingRecordCount: usageKeys.length,
      bullJobState: await job?.getState(),
      schedulerDue: discoveryTick.due + admissionTick.due,
      schedulerAdmitted: discoveryTick.admitted + admissionTick.admitted,
      scheduledRunStatus: canceled.status,
      scheduledCancellationEvents: canceled.events.filter(
        (event) => event.type === 'RUN_CANCELED'
      ).length,
      gracefulExitCodes: exitCodes,
      stoppedHealthRecords: 2,
    })
  );
} finally {
  await Promise.all(
    workers.map(async (worker) => {
      if (worker.exitCode === null) worker.kill('SIGTERM');
    })
  );
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.workerInstance.deleteMany({
    where: { buildVersion: 'phase22-runtime' },
  });
  await prisma.$disconnect();
  await redis.stop();
}
