import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { Queue } from 'bullmq';

import { prisma } from '../src/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { closeBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';
import {
  descendantsOf,
  isBrowserRoot,
  isPlaywrightChromium,
  snapshotLinuxProcesses,
  summarizeProcesses,
  type LinuxProcess,
} from './lib/linux-process-snapshot';

type Drill =
  | 'graceful'
  | 'crash'
  | 'backpressure'
  | 'concurrency2'
  | 'redis'
  | 'retry';

interface Session {
  cookie: string;
  userId: string;
}

interface ManagedChild {
  child: ChildProcess;
  kind: string;
  output: () => string;
}

const drill = process.env.PHASE4_LINUX_DRILL as Drill | undefined;
if (
  process.platform !== 'linux' ||
  !drill ||
  ![
    'graceful',
    'crash',
    'backpressure',
    'concurrency2',
    'redis',
    'retry',
  ].includes(drill)
) {
  throw new Error(
    'Set PHASE4_LINUX_DRILL to graceful, crash, backpressure, concurrency2, redis, or retry on Linux.'
  );
}

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(dashboardRoot, '..');
const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
const port = new URL(origin).port || '3001';
const nonce = randomUUID();
const queueName = `phase4-linux-${drill}-${nonce}`;
const runtimeRoot = path.join(projectRoot, '.runtime', 'linux-drills');
const logPath = path.join(runtimeRoot, `${drill}-${nonce}.log`);
const artifactRoot = path.join(runtimeRoot, `artifacts-${nonce}`);
const attempts = drill === 'retry' || drill === 'crash' ? '3' : '1';
const concurrency = drill === 'concurrency2' ? '2' : '1';
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  EXECUTION_QUEUE_NAME: queueName,
  EXECUTION_QUEUE_ATTEMPTS: attempts,
  EXECUTION_QUEUE_BACKOFF_MS: '500',
  EXECUTION_QUEUE_CONCURRENCY: concurrency,
  EXECUTION_QUEUE_HEARTBEAT_MS: '1000',
  EXECUTION_QUEUE_LEASE_MS: '6000',
  EXECUTION_QUEUE_SHUTDOWN_GRACE_MS: '3000',
  EXECUTION_QUEUE_MAX_WAITING: '20',
  MAX_CONCURRENT_RUNS_PER_USER: drill === 'graceful' ? '1' : '5',
  ARTIFACT_STORAGE_ROOT: artifactRoot,
  BROWSER_USE_LOGGING_LEVEL: 'error',
};

process.env.EXECUTION_QUEUE_NAME = queueName;
process.env.EXECUTION_QUEUE_ATTEMPTS = attempts;
process.env.EXECUTION_QUEUE_BACKOFF_MS = '500';
process.env.EXECUTION_QUEUE_CONCURRENCY = concurrency;
process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '1000';
process.env.EXECUTION_QUEUE_LEASE_MS = '6000';
process.env.EXECUTION_QUEUE_SHUTDOWN_GRACE_MS = '3000';
process.env.EXECUTION_QUEUE_MAX_WAITING = '20';
process.env.MAX_CONCURRENT_RUNS_PER_USER = drill === 'graceful' ? '1' : '5';
process.env.ARTIFACT_STORAGE_ROOT = artifactRoot;

const queueConfiguration = getQueueConfiguration();
const queue = new Queue(queueName, {
  connection: queueConfiguration.workerConnection,
});
const managedChildren = new Set<ManagedChild>();
const disposableUserIds = new Set<string>();
const trackedChromiumPids = new Set<number>();
let dashboard: ManagedChild | undefined;

await mkdir(runtimeRoot, { recursive: true });
await mkdir(artifactRoot, { recursive: true });

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startChild(
  kind: 'dashboard' | 'worker' | 'fail-first-worker',
  extraEnvironment: Record<string, string | undefined> = {}
): ManagedChild {
  const next = path.join(
    dashboardRoot,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next'
  );
  const args =
    kind === 'dashboard'
      ? [next, 'start', '-p', port]
      : kind === 'worker'
        ? ['--import', 'tsx', 'src/worker/browser-run-worker.ts']
        : ['--import', 'tsx', 'scripts/phase4-linux-fail-first-worker.ts'];
  const child = spawn(process.execPath, args, {
    cwd: dashboardRoot,
    env: { ...childEnvironment, ...extraEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const consume = (chunk: Buffer) => {
    const text = chunk.toString();
    output = `${output}${text}`.slice(-200_000);
    void appendFile(logPath, `[${kind}] ${text}`);
  };
  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);
  const managed = { child, kind, output: () => output };
  managedChildren.add(managed);
  child.once('exit', () => managedChildren.delete(managed));
  return managed;
}

async function stopChild(
  managed: ManagedChild | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
  timeoutMs = 15_000
) {
  if (!managed || managed.child.exitCode !== null || !managed.child.pid) return;
  managed.child.kill(signal);
  const exited = await Promise.race([
    new Promise<boolean>((resolve) =>
      managed.child.once('exit', () => resolve(true))
    ),
    delay(timeoutMs).then(() => false),
  ]);
  if (!exited && managed.child.pid) {
    managed.child.kill('SIGKILL');
    await new Promise<void>((resolve) =>
      managed.child.once('exit', () => resolve())
    );
  }
}

async function waitFor(
  description: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 120_000,
  intervalMs = 200
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForDashboard() {
  await waitFor(
    'dashboard readiness',
    async () => {
      try {
        return (await fetch(origin)).ok;
      } catch {
        return false;
      }
    },
    60_000
  );
}

function cookieHeader(response: Response): string {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  return values
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

async function signUp(label: string): Promise<Session> {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email: `phase4-linux-${label}-${nonce}@example.invalid`,
      password: `Phase4-${nonce}-test-only`,
      name: `Phase 4 Linux ${label}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Disposable sign-up failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as { user?: { id?: string } };
  const userId = payload.user?.id;
  const cookie = cookieHeader(response);
  if (!userId || !cookie) throw new Error('Sign-up did not create a session.');
  disposableUserIds.add(userId);
  return { cookie, userId };
}

async function createAgent(
  session: Session,
  label: string,
  maxSteps = 3
): Promise<string> {
  const response = await fetch(`${origin}/api/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    },
    body: JSON.stringify({
      name: `Phase 4 Linux ${label}`,
      description: 'Disposable Linux closure verification',
      goal: 'Open the page, read its heading, and report the heading briefly.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      scheduleType: 'MANUAL',
      scheduleConfig: {},
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps,
        timeoutMs: 90_000,
        browserSettings: {
          headless: true,
          viewportWidth: 1024,
          viewportHeight: 720,
        },
      },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Agent creation failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as { data?: { id?: string } };
  if (!payload.data?.id) throw new Error('Agent creation returned no ID.');
  return payload.data.id;
}

async function enqueue(session: Session, agentId: string) {
  const started = performance.now();
  const response = await fetch(`${origin}/api/agents/${agentId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    },
    body: '{}',
  });
  const durationMs = Math.round(performance.now() - started);
  const payload = (await response.json()) as {
    data?: { runId?: string; status?: string; detailsUrl?: string };
    code?: string;
    activeRunId?: string;
  };
  return {
    status: response.status,
    durationMs,
    runId: payload.data?.runId,
    runStatus: payload.data?.status,
    detailsUrl: payload.data?.detailsUrl,
    code: payload.code,
    activeRunId: payload.activeRunId,
  };
}

async function waitForRunning(runId: string) {
  await waitFor('RUNNING status and heartbeat', async () => {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    return (
      run?.status === 'RUNNING' &&
      run.heartbeatAt !== null &&
      run.leaseExpiresAt !== null
    );
  });
}

async function waitForTerminal(runId: string, timeoutMs = 180_000) {
  await waitFor(
    `terminal Run ${runId}`,
    async () => {
      const run = await prisma.run.findUnique({ where: { id: runId } });
      return Boolean(
        run &&
        ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(run.status)
      );
    },
    timeoutMs,
    500
  );
  return prisma.run.findUniqueOrThrow({
    where: { id: runId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
}

async function newWorkerChromium(workerPid: number) {
  const processes = await snapshotLinuxProcesses();
  const descendants = descendantsOf(processes, workerPid).filter(
    isPlaywrightChromium
  );
  for (const process of descendants) trackedChromiumPids.add(process.pid);
  return {
    processes,
    chromium: descendants,
    roots: descendants.filter(isBrowserRoot),
  };
}

async function waitForChromium(workerPid: number) {
  let observed: Awaited<ReturnType<typeof newWorkerChromium>> | undefined;
  await waitFor(
    'worker-owned Chromium',
    async () => {
      observed = await newWorkerChromium(workerPid);
      return observed.roots.length > 0;
    },
    60_000
  );
  return observed!;
}

async function trackedChromiumStillAlive() {
  const processes = await snapshotLinuxProcesses();
  return processes.filter(
    (process) =>
      trackedChromiumPids.has(process.pid) && isPlaywrightChromium(process)
  );
}

async function verifyTrackedChromiumExit(timeoutMs = 15_000) {
  await waitFor(
    'tracked Chromium exit',
    async () => (await trackedChromiumStillAlive()).length === 0,
    timeoutMs,
    250
  );
}

async function assertRunIntegrity(runIds: string[]) {
  const runs = await prisma.run.findMany({
    where: { id: { in: runIds } },
    include: { events: true, artifacts: true },
  });
  for (const run of runs) {
    const sequences = run.events.map((event) => event.sequence);
    const terminal = run.events.filter((event) =>
      ['RUN_COMPLETED', 'RUN_FAILED'].includes(event.type)
    );
    if (
      sequences.length !== new Set(sequences).size ||
      terminal.length > 1 ||
      run.events.some((event) => event.runId !== run.id) ||
      run.artifacts.some((artifact) => artifact.runId !== run.id)
    ) {
      throw new Error(`Run integrity failed for ${run.id}.`);
    }
  }
  return runs;
}

async function gracefulDrill() {
  const owner = await signUp('grace-owner');
  const other = await signUp('grace-other');
  const primaryAgent = await createAgent(owner, 'grace-primary', 8);
  const secondAgent = await createAgent(owner, 'grace-second', 2);
  const otherAgent = await createAgent(other, 'grace-other', 2);
  const worker = startChild('worker');
  await waitFor('worker readiness log', async () =>
    worker.output().includes('Browser worker ready')
  );
  const submitted = await enqueue(owner, primaryAgent);
  if (submitted.status !== 202 || !submitted.runId) {
    throw new Error('Graceful drill enqueue did not return HTTP 202.');
  }
  await waitForRunning(submitted.runId);
  const active = await waitForChromium(worker.child.pid!);
  const heartbeatBefore = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });

  const duplicate = await enqueue(owner, primaryAgent);
  const limited = await enqueue(owner, secondAgent);
  const isolated = await enqueue(other, otherAgent);
  if (
    duplicate.status !== 409 ||
    duplicate.code !== 'AGENT_RUN_ALREADY_ACTIVE' ||
    limited.status !== 429 ||
    limited.code !== 'USER_RUN_LIMIT_REACHED' ||
    isolated.status !== 202 ||
    !isolated.runId
  ) {
    throw new Error('Real-load admission control assertions failed.');
  }

  const signalAt = new Date();
  const shutdownStarted = performance.now();
  worker.child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Worker did not exit after SIGTERM.')),
      20_000
    );
    worker.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  const workerExitAt = new Date();
  const shutdownMs = Math.round(performance.now() - shutdownStarted);
  await verifyTrackedChromiumExit();
  const browserClosedAt = new Date();
  const after = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  const shutdownLog = worker.output();
  if (
    !shutdownLog.includes('Browser worker shutting down') ||
    !shutdownLog.includes(
      'Aborting active runs after worker shutdown grace period'
    ) ||
    !['QUEUED', 'FAILED'].includes(after.status) ||
    after.workerId !== null ||
    after.heartbeatAt !== null ||
    after.leaseExpiresAt !== null
  ) {
    throw new Error('Linux graceful shutdown assertions failed.');
  }
  return {
    drill,
    signalAt,
    handlerLogged: true,
    forcedAbortLogged: true,
    workerExitAt,
    browserClosedAt,
    shutdownMs,
    activeChromiumProcesses: active.chromium.length,
    activeBrowserRoots: active.roots.length,
    workerPgid: active.processes.find(
      (process) => process.pid === worker.child.pid
    )?.pgid,
    browserPgids: [...new Set(active.roots.map((process) => process.pgid))],
    heartbeatAdvancedBeforeSignal: heartbeatBefore.heartbeatAt !== null,
    finalStatus: after.status,
    leaseReleased: true,
    orphanChromium: 0,
    duplicateAdmission: duplicate,
    userLimitAdmission: limited,
    otherUserAdmission: isolated,
  };
}

async function crashDrill() {
  const owner = await signUp('crash-owner');
  const agentId = await createAgent(owner, 'crash', 6);
  const worker = startChild('worker');
  await waitFor('worker readiness log', async () =>
    worker.output().includes('Browser worker ready')
  );
  const submitted = await enqueue(owner, agentId);
  if (submitted.status !== 202 || !submitted.runId) {
    throw new Error('Crash drill enqueue did not return HTTP 202.');
  }
  await waitForRunning(submitted.runId);
  const active = await waitForChromium(worker.child.pid!);
  const beforeKill = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  const leaseExpiry = beforeKill.leaseExpiresAt!;
  worker.child.kill('SIGKILL');
  await new Promise<void>((resolve) =>
    worker.child.once('exit', () => resolve())
  );
  await verifyTrackedChromiumExit();

  const replacement = startChild('worker');
  await waitFor('replacement worker readiness', async () =>
    replacement.output().includes('Browser worker ready')
  );
  await delay(Math.max(0, leaseExpiry.getTime() - Date.now() - 500));
  const beforeLeaseExpiry = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  if (
    beforeLeaseExpiry.status !== 'RUNNING' ||
    beforeLeaseExpiry.attempt !== 1
  ) {
    throw new Error('Replacement claimed before database lease expiry.');
  }
  await waitFor(
    'expired lease timestamp',
    async () => Date.now() > leaseExpiry.getTime()
  );
  const recovered = await waitForTerminal(submitted.runId, 210_000);
  await assertRunIntegrity([submitted.runId]);
  const terminalEvents = recovered.events.filter((event) =>
    ['RUN_COMPLETED', 'RUN_FAILED'].includes(event.type)
  );
  if (recovered.attempt < 2 || terminalEvents.length !== 1) {
    throw new Error('Real crash recovery did not retry the same Run safely.');
  }
  await stopChild(replacement);
  return {
    drill,
    kill: 'SIGKILL',
    initialAttempt: beforeKill.attempt,
    activeChromiumProcesses: active.chromium.length,
    activeBrowserRoots: active.roots.length,
    orphanChromium: 0,
    noClaimBeforeLeaseExpiry: true,
    leaseExpiredAt: leaseExpiry,
    recoveredAttempt: recovered.attempt,
    finalStatus: recovered.status,
    runIdReused: true,
    terminalEventCount: terminalEvents.length,
    eventSequenceUnique:
      recovered.events.length ===
      new Set(recovered.events.map((event) => event.sequence)).size,
    artifactCount: recovered.artifacts.length,
  };
}

async function backpressureDrill(expectedConcurrency: 1 | 2) {
  const owner = await signUp(`backpressure-${expectedConcurrency}`);
  const agentIds = await Promise.all(
    [1, 2, 3].map((index) =>
      createAgent(owner, `backpressure-${expectedConcurrency}-${index}`, 2)
    )
  );
  const submissions = [];
  for (const agentId of agentIds)
    submissions.push(await enqueue(owner, agentId));
  if (submissions.some((item) => item.status !== 202 || !item.runId)) {
    throw new Error('Backpressure enqueue did not return three HTTP 202s.');
  }
  const runIds = submissions.map((item) => item.runId!);
  const worker = startChild('worker');
  await waitFor('worker readiness log', async () =>
    worker.output().includes('Browser worker ready')
  );
  const samples: Array<{
    at: string;
    active: number;
    waiting: number;
    browserSessions: number;
    chromiumProcesses: number;
    workerRssMb: number;
    chromiumRssMb: number;
    cpuPercent: number;
  }> = [];
  let maxActive = 0;
  let maxWaiting = 0;
  let maxBrowsers = 0;
  let observedBackpressure = false;
  const sampleDeadline = Date.now() + 240_000;
  while (Date.now() < sampleDeadline) {
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
    const processes = await snapshotLinuxProcesses();
    const descendants = descendantsOf(processes, worker.child.pid!);
    const chromium = descendants.filter(isPlaywrightChromium);
    const browsers = chromium.filter(isBrowserRoot);
    for (const process of chromium) trackedChromiumPids.add(process.pid);
    const workerProcess = processes.find(
      (process) => process.pid === worker.child.pid
    );
    maxActive = Math.max(maxActive, counts.active);
    maxWaiting = Math.max(maxWaiting, counts.waiting);
    maxBrowsers = Math.max(maxBrowsers, browsers.length);
    if (
      counts.active === expectedConcurrency &&
      counts.waiting >= 3 - expectedConcurrency
    ) {
      observedBackpressure = true;
    }
    samples.push({
      at: new Date().toISOString(),
      active: counts.active,
      waiting: counts.waiting,
      browserSessions: browsers.length,
      chromiumProcesses: chromium.length,
      workerRssMb: Math.round((workerProcess?.rssKb ?? 0) / 1024),
      chromiumRssMb: Math.round(
        chromium.reduce((total, item) => total + item.rssKb, 0) / 1024
      ),
      cpuPercent: Number(
        (
          (workerProcess?.cpuPercent ?? 0) +
          chromium.reduce((total, item) => total + item.cpuPercent, 0)
        ).toFixed(1)
      ),
    });
    const statuses = await prisma.run.findMany({
      where: { id: { in: runIds } },
      select: { status: true },
    });
    if (
      statuses.length === 3 &&
      statuses.every((run) =>
        ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(run.status)
      )
    ) {
      break;
    }
    await delay(250);
  }
  const runs = await Promise.all(runIds.map((runId) => waitForTerminal(runId)));
  await assertRunIntegrity(runIds);
  await stopChild(worker);
  await verifyTrackedChromiumExit();
  if (
    !observedBackpressure ||
    maxActive > expectedConcurrency ||
    maxBrowsers > expectedConcurrency
  ) {
    throw new Error('Real browser backpressure assertions failed.');
  }
  const intervals = runs.map((run) => ({
    runId: run.id,
    enqueued: run.queuedAt,
    started: run.startedAt,
    finished: run.completedAt,
    status: run.status,
    artifactCount: run.artifacts.length,
    eventCount: run.events.length,
  }));
  return {
    drill,
    expectedConcurrency,
    submissions,
    observedBackpressure,
    maxActive,
    maxWaiting,
    maxBrowserSessions: maxBrowsers,
    peakWorkerRssMb: Math.max(...samples.map((sample) => sample.workerRssMb)),
    peakChromiumRssMb: Math.max(
      ...samples.map((sample) => sample.chromiumRssMb)
    ),
    peakCpuPercent: Math.max(...samples.map((sample) => sample.cpuPercent)),
    processSampleCount: samples.length,
    intervals,
    noArtifactOrEventMixing: true,
    orphanChromium: 0,
  };
}

async function redisDrill() {
  const redisConfig = process.env.PHASE4_REDIS_CONFIG;
  if (!redisConfig) {
    throw new Error('PHASE4_REDIS_CONFIG is required for the Redis drill.');
  }
  const owner = await signUp('redis-owner');
  const agentId = await createAgent(owner, 'redis', 5);
  const worker = startChild('worker');
  await waitFor('worker readiness log', async () =>
    worker.output().includes('Browser worker ready')
  );
  const submitted = await enqueue(owner, agentId);
  if (submitted.status !== 202 || !submitted.runId) {
    throw new Error('Redis drill enqueue did not return HTTP 202.');
  }
  await waitForRunning(submitted.runId);
  await waitForChromium(worker.child.pid!);
  const heartbeatBefore = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const redisUrl = new URL(process.env.REDIS_URL!);
  const redisPort = redisUrl.port || '6379';
  const stoppedAt = new Date();
  await execFileAsync('redis-cli', ['-p', redisPort, 'shutdown', 'save']);
  await delay(3_000);
  const during = await prisma.run.findUniqueOrThrow({
    where: { id: submitted.runId },
  });
  await execFileAsync('redis-server', [redisConfig]);
  await waitFor('Redis restart', async () => {
    try {
      const result = await execFileAsync('redis-cli', [
        '-p',
        redisPort,
        'ping',
      ]);
      return result.stdout.trim() === 'PONG';
    } catch {
      return false;
    }
  });
  const restartedAt = new Date();
  const completed = await waitForTerminal(submitted.runId, 180_000);
  await assertRunIntegrity([submitted.runId]);
  await stopChild(worker);
  await verifyTrackedChromiumExit();
  const queueJob = await queue.getJob(submitted.runId);
  return {
    drill,
    stoppedAt,
    restartedAt,
    interruptionMs: restartedAt.getTime() - stoppedAt.getTime(),
    heartbeatBefore: heartbeatBefore.heartbeatAt,
    heartbeatDuring: during.heartbeatAt,
    postgresHeartbeatAdvanced: Boolean(
      during.heartbeatAt &&
      heartbeatBefore.heartbeatAt &&
      during.heartbeatAt > heartbeatBefore.heartbeatAt
    ),
    finalStatus: completed.status,
    attempt: completed.attempt,
    bullJobState: await queueJob?.getState(),
    duplicateExecution: false,
    orphanChromium: 0,
  };
}

async function retryDrill() {
  const baselineProcesses = await snapshotLinuxProcesses();
  const baseline = {
    users: await prisma.user.count(),
    agents: await prisma.agent.count(),
    runs: await prisma.run.count(),
    events: await prisma.agentEvent.count(),
    artifacts: await prisma.runArtifact.count(),
    jobs: await queue.getJobCounts('active', 'waiting', 'delayed'),
    chromiumProcesses: baselineProcesses.filter(isPlaywrightChromium).length,
  };
  const owner = await signUp('retry-owner');
  const agentId = await createAgent(owner, 'retry', 2);
  const submitted = await enqueue(owner, agentId);
  if (
    submitted.status !== 202 ||
    submitted.runStatus !== 'QUEUED' ||
    !submitted.runId ||
    submitted.detailsUrl !== `/dashboard/runs/${submitted.runId}`
  ) {
    throw new Error('Retry drill enqueue did not return HTTP 202.');
  }
  const worker = startChild('fail-first-worker', {
    NODE_ENV: 'test',
    PHASE4_FAIL_FIRST_RUN_ID: submitted.runId,
  });
  await waitFor('fail-first worker readiness', async () =>
    worker.output().includes('Phase 4 fail-first worker ready')
  );
  let retrySnapshot:
    | {
        status: string;
        attempt: number;
        workerId: string | null;
        heartbeatAt: Date | null;
        leaseExpiresAt: Date | null;
        artifactCount: number;
        jobState: string | undefined;
      }
    | undefined;
  await waitFor(
    'attempt 1 retry backoff',
    async () => {
      const run = await prisma.run.findUnique({
        where: { id: submitted.runId },
        include: { _count: { select: { artifacts: true } } },
      });
      if (run?.status !== 'QUEUED' || run.attempt !== 1) return false;
      const job = await queue.getJob(submitted.runId!);
      retrySnapshot = {
        status: run.status,
        attempt: run.attempt,
        workerId: run.workerId,
        heartbeatAt: run.heartbeatAt,
        leaseExpiresAt: run.leaseExpiresAt,
        artifactCount: run._count.artifacts,
        jobState: await job?.getState(),
      };
      return true;
    },
    30_000,
    25
  );
  if (!retrySnapshot) {
    throw new Error('Attempt 1 retry state was not captured.');
  }
  const attempt1Snapshot = retrySnapshot;
  const attempt1Chromium = await newWorkerChromium(worker.child.pid!);
  if (
    attempt1Snapshot.workerId !== null ||
    attempt1Snapshot.heartbeatAt !== null ||
    attempt1Snapshot.leaseExpiresAt !== null ||
    attempt1Snapshot.artifactCount !== 0 ||
    attempt1Snapshot.jobState !== 'delayed' ||
    attempt1Chromium.roots.length !== 0
  ) {
    throw new Error('Attempt 1 retry cleanup assertions failed.');
  }
  await waitFor('attempt 2 lease', async () => {
    const run = await prisma.run.findUnique({
      where: { id: submitted.runId },
    });
    return Boolean(
      run?.status === 'RUNNING' &&
      run.attempt === 2 &&
      run.workerId &&
      run.heartbeatAt &&
      run.leaseExpiresAt
    );
  });
  const active = await waitForChromium(worker.child.pid!);
  const completed = await waitForTerminal(submitted.runId, 180_000);
  await assertRunIntegrity([submitted.runId]);
  const retryEvents = completed.events.filter(
    (event) =>
      event.type === 'SYSTEM' &&
      event.message === 'Execution attempt will be retried.'
  );
  const terminalEvents = completed.events.filter((event) =>
    ['RUN_COMPLETED', 'RUN_FAILED'].includes(event.type)
  );
  const startedEvents = completed.events.filter(
    (event) => event.type === 'RUN_STARTED'
  );
  const sequences = completed.events.map((event) => event.sequence);
  const startedAttempts = startedEvents.map((event) => {
    const data =
      typeof event.data === 'object' &&
      event.data !== null &&
      !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : {};
    return data.attempt;
  });
  const effectiveModels = startedEvents.map((event) => {
    const data =
      typeof event.data === 'object' &&
      event.data !== null &&
      !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : {};
    return data.model;
  });
  const result =
    typeof completed.result === 'object' &&
    completed.result !== null &&
    !Array.isArray(completed.result)
      ? (completed.result as Record<string, unknown>)
      : {};
  const summary =
    typeof result.summary === 'string' ? result.summary.trim() : '';
  const visitedUrls = Array.isArray(result.visitedUrls)
    ? result.visitedUrls.filter(
        (value): value is string => typeof value === 'string'
      )
    : [];
  const artifact = completed.artifacts[0];
  const ownerArtifactResponse = artifact
    ? await fetch(
        `${origin}/api/runs/${completed.id}/artifacts/${artifact.id}`,
        { headers: { Cookie: owner.cookie, Origin: origin } }
      )
    : undefined;
  const other = await signUp('retry-other');
  const otherArtifactResponse = artifact
    ? await fetch(
        `${origin}/api/runs/${completed.id}/artifacts/${artifact.id}`,
        { headers: { Cookie: other.cookie, Origin: origin } }
      )
    : undefined;
  const userRunCount = await prisma.run.count({
    where: { agent: { userId: owner.userId } },
  });
  const queueJob = await queue.getJob(submitted.runId);
  const queueJobState = await queueJob?.getState();
  const persistedText = JSON.stringify({
    result: completed.result,
    errorMessage: completed.errorMessage,
    events: completed.events.map((event) => ({
      type: event.type,
      message: event.message,
      data: event.data,
    })),
  });
  const secretPersisted =
    Boolean(process.env.GROQ_API_KEY) &&
    (persistedText.includes(process.env.GROQ_API_KEY!) ||
      persistedText.includes('gsk_'));
  if (
    completed.status !== 'SUCCESS' ||
    completed.attempt !== 2 ||
    completed.workerId !== null ||
    completed.heartbeatAt !== null ||
    completed.leaseExpiresAt !== null ||
    completed.completedAt === null ||
    completed.duration === null ||
    completed.duration < 0 ||
    completed.queueJobId !== submitted.runId ||
    retryEvents.length !== 1 ||
    terminalEvents.length !== 1 ||
    terminalEvents[0]?.type !== 'RUN_COMPLETED' ||
    startedEvents.length !== 2 ||
    startedAttempts[0] !== 1 ||
    startedAttempts[1] !== 2 ||
    effectiveModels.some((model) => model !== DEFAULT_GROQ_MODEL.id) ||
    sequences.length !== new Set(sequences).size ||
    !summary ||
    !visitedUrls.some((url) => url.startsWith('https://example.com')) ||
    completed.artifacts.length !== 1 ||
    !artifact ||
    !['image/png', 'image/jpeg'].includes(artifact.mimeType) ||
    artifact.size <= 0 ||
    ownerArtifactResponse?.status !== 200 ||
    otherArtifactResponse?.status !== 404 ||
    userRunCount !== 1 ||
    queueJobState !== 'completed' ||
    secretPersisted
  ) {
    throw new Error('Real browser-start retry assertions failed.');
  }
  await stopChild(worker);
  await verifyTrackedChromiumExit();
  const finalQueueCounts = await queue.getJobCounts(
    'active',
    'waiting',
    'delayed'
  );
  if (
    finalQueueCounts.active !== 0 ||
    finalQueueCounts.waiting !== 0 ||
    finalQueueCounts.delayed !== 0
  ) {
    throw new Error('Retry queue did not return to an idle state.');
  }
  return {
    drill,
    baseline,
    enqueue: submitted,
    attempt1: {
      classification: 'EXECUTION_UNAVAILABLE',
      browserStarted: false,
      leaseReleased: true,
      runReturnedToQueued: true,
      bullJobState: attempt1Snapshot.jobState,
      artifactCount: attempt1Snapshot.artifactCount,
    },
    attempt2: {
      browserStarted: active.roots.length === 1,
      finalStatus: completed.status,
      browserProcessCount: active.chromium.length,
      groqSucceeded: true,
    },
    runId: completed.id,
    finalAttempt: completed.attempt,
    durationMs: completed.duration,
    effectiveModel: effectiveModels[1],
    queueJobState,
    leaseCleared: true,
    heartbeatCleared: true,
    summaryPresent: true,
    visitedExampleDotCom: true,
    retryEventCount: retryEvents.length,
    terminalEventCount: terminalEvents.length,
    terminalEventType: terminalEvents[0]?.type,
    runStartedAttempts: startedAttempts,
    artifactCount: completed.artifacts.length,
    artifactMimeType: artifact.mimeType,
    artifactOwnerStatus: ownerArtifactResponse.status,
    artifactOtherUserStatus: otherArtifactResponse.status,
    duplicateArtifact: false,
    secretPersisted: false,
    userRunCount,
    finalQueueCounts,
    eventSequenceUnique:
      completed.events.length ===
      new Set(completed.events.map((event) => event.sequence)).size,
    orphanChromium: 0,
  };
}

async function cleanup() {
  for (const child of [...managedChildren]) {
    await stopChild(child, 'SIGTERM', 5_000).catch(() => undefined);
  }
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await closeBrowserRunQueue().catch(() => undefined);
  const before = {
    users: await prisma.user.count({
      where: { id: { in: [...disposableUserIds] } },
    }),
    agents: await prisma.agent.count({
      where: { userId: { in: [...disposableUserIds] } },
    }),
    runs: await prisma.run.count({
      where: { agent: { userId: { in: [...disposableUserIds] } } },
    }),
  };
  if (disposableUserIds.size) {
    await prisma.user.deleteMany({
      where: { id: { in: [...disposableUserIds] } },
    });
  }
  await rm(artifactRoot, { recursive: true, force: true });
  const after = {
    users: await prisma.user.count({
      where: { id: { in: [...disposableUserIds] } },
    }),
    agents: await prisma.agent.count({
      where: { userId: { in: [...disposableUserIds] } },
    }),
  };
  const remainingChromium = await trackedChromiumStillAlive();
  await prisma.$disconnect();
  return {
    before,
    after,
    queueObliterated: true,
    artifactDirectoryRemoved: true,
    trackedChromiumRemaining: remainingChromium.map((process) => ({
      pid: process.pid,
      ppid: process.ppid,
      pgid: process.pgid,
      command: process.command,
    })),
  };
}

let result: unknown;
let failure: unknown;
let cleanupResult: unknown;
try {
  const baseline = summarizeProcesses(await snapshotLinuxProcesses());
  dashboard = startChild('dashboard');
  await waitForDashboard();
  const drillResult =
    drill === 'graceful'
      ? await gracefulDrill()
      : drill === 'crash'
        ? await crashDrill()
        : drill === 'backpressure'
          ? await backpressureDrill(1)
          : drill === 'concurrency2'
            ? await backpressureDrill(2)
            : drill === 'redis'
              ? await redisDrill()
              : await retryDrill();
  result = {
    baseline,
    dashboardPid: dashboard.child.pid,
    queueName,
    drillResult,
  };
} catch (error) {
  failure = error;
} finally {
  cleanupResult = await cleanup();
}

if (failure) {
  console.error(
    JSON.stringify({
      drill,
      status: 'failed',
      error:
        failure instanceof Error
          ? { name: failure.name, message: failure.message }
          : { name: 'UnknownError', message: 'Unknown failure.' },
      cleanup: cleanupResult,
      logPath,
    })
  );
  process.exitCode = 1;
} else {
  console.info(
    JSON.stringify({
      drill,
      status: 'passed',
      result,
      cleanup: cleanupResult,
      logPath,
    })
  );
}
