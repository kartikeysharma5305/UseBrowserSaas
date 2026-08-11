import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentEventType, RunStatus, type Agent } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import {
  BrowserExecutionService,
  type BrowserExecutionInput,
} from '../src/lib/browser/engine';
import { PrismaRunPersistence } from '../src/lib/browser/run-persistence';
import { prisma } from '../src/lib/db/prisma';
import { ExecutionServiceError } from '../src/lib/execution/errors';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import type { AgentExecutionResult } from '../src/lib/execution/types';
import {
  closeBrowserRunQueue,
  enqueueBrowserRun,
} from '../src/lib/queue/browser-run-queue';
import {
  getQueueConfiguration,
  type QueueConfiguration,
} from '../src/lib/queue/config';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';
import { BrowserRunProcessor } from '../src/lib/worker/browser-run-processor';

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const artifactRoot = await mkdtemp(path.join(tmpdir(), 'phase4-reliability-'));
const redis = await RedisMemoryServer.create();
const nonce = randomUUID();
process.env.REDIS_URL = `redis://${await redis.getHost()}:${await redis.getPort()}`;
process.env.EXECUTION_QUEUE_NAME = `phase4-reliability-${nonce}`;
process.env.EXECUTION_QUEUE_ATTEMPTS = '3';
process.env.EXECUTION_QUEUE_BACKOFF_MS = '100';
process.env.EXECUTION_QUEUE_CONCURRENCY = '1';
process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '1000';
process.env.EXECUTION_QUEUE_LEASE_MS = '5000';
process.env.MAX_CONCURRENT_RUNS_PER_USER = '10';
process.env.ARTIFACT_STORAGE_ROOT = artifactRoot;
process.env.BROWSER_USE_LOGGING_LEVEL = 'error';

const configuration = getQueueConfiguration();
const queue = new Queue(configuration.queueName, {
  connection: configuration.workerConnection,
});
const producer = new PrismaRunProducer();
const createdUserIds: string[] = [];
let worker: Worker | undefined;

async function createUserAndAgents(count: number) {
  const user = await prisma.user.create({
    data: {
      email: `phase4-reliability-${randomUUID()}@example.invalid`,
      name: 'Phase 4 reliability verification',
    },
  });
  createdUserIds.push(user.id);
  const agents: Agent[] = [];
  for (let index = 0; index < count; index += 1) {
    agents.push(
      await prisma.agent.create({
        data: {
          userId: user.id,
          name: `Phase 4 reliability agent ${index + 1}`,
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
            },
          },
        },
      })
    );
  }
  return { user, agents };
}

async function waitForCompleted(runIds: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await prisma.run.findMany({
      where: { id: { in: runIds } },
      select: { id: true, status: true },
    });
    if (
      runs.length === runIds.length &&
      runs.every((run) =>
        ['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(run.status)
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Reliability drill timed out waiting for terminal runs.');
}

class FailFirstThenExecute extends BrowserExecutionService {
  runId: string | undefined;
  injectedFailures = 0;
  private readonly controlledPersistence = new PrismaRunPersistence();

  override async execute(
    input: BrowserExecutionInput
  ): Promise<AgentExecutionResult> {
    if (input.runId === this.runId && this.injectedFailures === 0) {
      this.injectedFailures += 1;
      throw new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
        stage: 'browser_start',
        runId: input.runId,
      });
    }
    const runId = input.runId;
    if (!runId) throw new Error('Controlled retry requires a Run ID.');
    const startedAt = input.startedAt ?? new Date();
    await this.controlledPersistence.finalizeRun({
      runId,
      startedAt,
      status: 'SUCCESS',
      result: {
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        summary: 'Controlled retry completed.',
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
      summary: 'Controlled retry completed.',
      visitedUrls: ['https://example.com/'],
      eventCount: 1,
      artifactCount: 0,
      detailsUrl: `/dashboard/runs/${runId}`,
    };
  }
}

class ObservedBrowserExecution extends BrowserExecutionService {
  active = 0;
  maximumActive = 0;
  order: string[] = [];
  private readonly controlledPersistence = new PrismaRunPersistence();

  override async execute(
    input: BrowserExecutionInput
  ): Promise<AgentExecutionResult> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    if (input.runId) this.order.push(input.runId);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const runId = input.runId;
      if (!runId) throw new Error('Controlled execution requires a Run ID.');
      const startedAt = input.startedAt ?? new Date();
      await this.controlledPersistence.finalizeRun({
        runId,
        startedAt,
        status: 'SUCCESS',
        result: {
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          summary: 'Controlled backpressure execution completed.',
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
        summary: 'Controlled backpressure execution completed.',
        visitedUrls: ['https://example.com/'],
        eventCount: 1,
        artifactCount: 0,
        detailsUrl: `/dashboard/runs/${runId}`,
      };
    } finally {
      this.active -= 1;
    }
  }
}

async function runRetryDrill() {
  const { user, agents } = await createUserAndAgents(1);
  const submitted = await producer.enqueue({
    agentId: agents[0]!.id,
    userId: user.id,
  });
  const execution = new FailFirstThenExecute();
  execution.runId = submitted.runId;
  const processor = new BrowserRunProcessor(
    `retry-${nonce}`,
    configuration,
    execution
  );
  worker = new Worker(
    configuration.queueName,
    (job) => processor.process(job),
    { connection: configuration.workerConnection, concurrency: 1 }
  );
  await waitForCompleted([submitted.runId], 180_000);
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
  const terminalEvents = run.events.filter(
    (event) =>
      event.type === AgentEventType.RUN_COMPLETED ||
      event.type === AgentEventType.RUN_FAILED
  );
  const retryEvents = run.events.filter(
    (event) =>
      event.type === AgentEventType.SYSTEM &&
      event.message === 'Execution attempt will be retried.'
  );
  if (
    run.status !== RunStatus.SUCCESS ||
    run.attempt !== 2 ||
    execution.injectedFailures !== 1 ||
    retryEvents.length !== 1 ||
    terminalEvents.length !== 1
  ) {
    throw new Error('Fail-then-success retry assertions failed.');
  }
  await worker.close();
  worker = undefined;
  return {
    runId: submitted.runId,
    attempt: run.attempt,
    retryEvents: retryEvents.length,
    terminalEvents: terminalEvents.length,
    artifactCount: run.artifacts.length,
    sequenceUnique:
      new Set(run.events.map((event) => event.sequence)).size ===
      run.events.length,
  };
}

async function runBackpressureDrill() {
  const { user, agents } = await createUserAndAgents(3);
  const submissions = [];
  const enqueueTimes: number[] = [];
  for (const agent of agents) {
    const started = performance.now();
    submissions.push(
      await producer.enqueue({ agentId: agent.id, userId: user.id })
    );
    enqueueTimes.push(Math.round(performance.now() - started));
  }
  const runIds = submissions.map((submission) => submission.runId);
  const waitingBeforeWorker = await queue.getWaitingCount();
  const execution = new ObservedBrowserExecution();
  const processor = new BrowserRunProcessor(
    `backpressure-${nonce}`,
    configuration,
    execution
  );
  worker = new Worker(
    configuration.queueName,
    (job) => processor.process(job),
    { connection: configuration.workerConnection, concurrency: 1 }
  );
  const observationDeadline = Date.now() + 30_000;
  let observedCounts = { active: 0, waiting: waitingBeforeWorker };
  while (Date.now() < observationDeadline) {
    observedCounts = {
      active: await queue.getActiveCount(),
      waiting: await queue.getWaitingCount(),
    };
    if (observedCounts.active === 1 && observedCounts.waiting >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await waitForCompleted(runIds, 300_000);
  const runs = await prisma.run.findMany({
    where: { id: { in: runIds } },
    include: { events: true, artifacts: true },
  });
  if (
    waitingBeforeWorker !== 3 ||
    observedCounts.active !== 1 ||
    observedCounts.waiting < 2 ||
    execution.maximumActive !== 1 ||
    runs.some((run) => run.status !== RunStatus.SUCCESS)
  ) {
    throw new Error('Real backpressure assertions failed.');
  }
  await worker.close();
  worker = undefined;
  return {
    waitingBeforeWorker,
    observedActive: observedCounts.active,
    observedWaiting: observedCounts.waiting,
    maximumControlledExecutions: execution.maximumActive,
    processingOrder: execution.order,
    enqueueTimes,
    finalStatuses: runs.map((run) => run.status),
    artifactCounts: runs.map((run) => run.artifacts.length),
    sequencesUnique: runs.every(
      (run) =>
        new Set(run.events.map((event) => event.sequence)).size ===
        run.events.length
    ),
  };
}

async function runRecoveryCommand(
  apply: boolean
): Promise<Record<string, number | string>> {
  const command = path.join(
    dashboardRoot,
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs'
  );
  const child = spawn(
    process.execPath,
    [command, 'scripts/recover-queue.ts', ...(apply ? ['--apply'] : [])],
    {
      cwd: dashboardRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exitCode = await new Promise<number>((resolve) =>
    child.once('exit', (code) => resolve(code ?? 1))
  );
  if (exitCode !== 0) throw new Error(`Recovery command failed: ${output}`);
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('{"mode"'));
  if (!line) throw new Error('Recovery command did not emit a report.');
  return JSON.parse(line) as Record<string, number | string>;
}

async function runRecoveryDrill() {
  const { agents } = await createUserAndAgents(6);
  const now = new Date();
  const fixtureIds = {
    queuedMissing: randomUUID(),
    expired: randomUUID(),
    exhausted: randomUUID(),
    terminal: randomUUID(),
    duplicate: randomUUID(),
    orphan: randomUUID(),
  };
  await prisma.run.createMany({
    data: [
      {
        id: fixtureIds.queuedMissing,
        agentId: agents[0]!.id,
        status: RunStatus.QUEUED,
        queueJobId: fixtureIds.queuedMissing,
        queuedAt: now,
      },
      {
        id: fixtureIds.expired,
        agentId: agents[1]!.id,
        status: RunStatus.RUNNING,
        queueJobId: fixtureIds.expired,
        queuedAt: now,
        workerId: 'expired-worker',
        heartbeatAt: new Date(now.getTime() - 10_000),
        leaseExpiresAt: new Date(now.getTime() - 5_000),
        attempt: 1,
      },
      {
        id: fixtureIds.exhausted,
        agentId: agents[2]!.id,
        status: RunStatus.RUNNING,
        queueJobId: fixtureIds.exhausted,
        queuedAt: now,
        workerId: 'exhausted-worker',
        heartbeatAt: new Date(now.getTime() - 10_000),
        leaseExpiresAt: new Date(now.getTime() - 5_000),
        attempt: configuration.attempts,
      },
      {
        id: fixtureIds.terminal,
        agentId: agents[3]!.id,
        status: RunStatus.SUCCESS,
        queueJobId: fixtureIds.terminal,
        queuedAt: now,
        completedAt: now,
      },
      {
        id: fixtureIds.duplicate,
        agentId: agents[4]!.id,
        status: RunStatus.QUEUED,
        queueJobId: fixtureIds.duplicate,
        queuedAt: now,
      },
    ],
  });
  await prisma.agentEvent.createMany({
    data: Object.values(fixtureIds)
      .filter((id) => id !== fixtureIds.orphan)
      .map((runId) => ({
        runId,
        sequence: 1,
        type: AgentEventType.RUN_CREATED,
        message: 'Recovery fixture.',
        data: {},
      })),
  });
  await enqueueBrowserRun(queue, fixtureIds.orphan);
  await enqueueBrowserRun(queue, fixtureIds.terminal);
  await enqueueBrowserRun(queue, fixtureIds.duplicate);
  await enqueueBrowserRun(queue, fixtureIds.duplicate);

  const before = await prisma.run.findMany({
    where: { id: { in: Object.values(fixtureIds) } },
    select: { id: true, status: true, attempt: true },
    orderBy: { id: 'asc' },
  });
  const dryRun = await runRecoveryCommand(false);
  const afterDryRun = await prisma.run.findMany({
    where: { id: { in: Object.values(fixtureIds) } },
    select: { id: true, status: true, attempt: true },
    orderBy: { id: 'asc' },
  });
  if (JSON.stringify(before) !== JSON.stringify(afterDryRun)) {
    throw new Error('Recovery dry-run mutated PostgreSQL state.');
  }
  const applied = await runRecoveryCommand(true);
  const fixtures = await prisma.run.findMany({
    where: { id: { in: Object.values(fixtureIds) } },
    include: { events: true },
  });
  const byId = new Map(fixtures.map((run) => [run.id, run]));
  const expectedJobs = await Promise.all([
    queue.getJob(fixtureIds.queuedMissing),
    queue.getJob(fixtureIds.expired),
    queue.getJob(fixtureIds.exhausted),
    queue.getJob(fixtureIds.terminal),
    queue.getJob(fixtureIds.duplicate),
    queue.getJob(fixtureIds.orphan),
  ]);
  if (
    byId.get(fixtureIds.queuedMissing)?.status !== RunStatus.QUEUED ||
    byId.get(fixtureIds.expired)?.status !== RunStatus.QUEUED ||
    byId.get(fixtureIds.exhausted)?.status !== RunStatus.FAILED ||
    expectedJobs[0] === undefined ||
    expectedJobs[1] === undefined ||
    expectedJobs[2] !== undefined ||
    expectedJobs[3] !== undefined ||
    expectedJobs[4] === undefined ||
    expectedJobs[5] !== undefined
  ) {
    throw new Error('Recovery apply did not reconcile fixtures as expected.');
  }
  return {
    dryRun,
    applied,
    dryRunNoMutation: true,
    expiredEventRecorded:
      byId
        .get(fixtureIds.expired)
        ?.events.some(
          (event) =>
            event.type === AgentEventType.SYSTEM &&
            event.message.includes('expired worker lease')
        ) === true,
    exhaustedTerminalEventCount:
      byId
        .get(fixtureIds.exhausted)
        ?.events.filter((event) => event.type === AgentEventType.RUN_FAILED)
        .length ?? 0,
    duplicateJobCount: (await queue.getJobs(['waiting', 'delayed'])).filter(
      (job) => job.id === fixtureIds.duplicate
    ).length,
  };
}

try {
  const retry = await runRetryDrill();
  const backpressure = await runBackpressureDrill();
  const recovery = await runRecoveryDrill();
  console.info(JSON.stringify({ retry, backpressure, recovery }));
} finally {
  await worker?.close().catch(() => undefined);
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue();
  for (const userId of createdUserIds) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
  await redis.stop();
  await rm(artifactRoot, { recursive: true, force: true });
}
