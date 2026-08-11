import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { Queue } from 'bullmq';

import { prisma } from '../src/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { getQueueConfiguration } from '../src/lib/queue/config';
import {
  isPlaywrightChromium,
  snapshotLinuxProcesses,
} from './lib/linux-process-snapshot';

interface Session {
  cookie: string;
  userId: string;
}

interface ManagedChild {
  child: ChildProcess;
  output: () => string;
}

interface SseFrame {
  event: string;
  id?: number;
  data: unknown;
}

if (process.platform !== 'linux') {
  throw new Error('Phase 5 runtime verification requires Linux.');
}

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(dashboardRoot, '..');
const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
const port = new URL(origin).port || '3001';
const nonce = randomUUID();
const redisPort = 6382;
const queueName = `phase5-runtime-${nonce}`;
const runtimeRoot = path.join(projectRoot, '.runtime', 'phase5', nonce);
const artifactRoot = path.join(runtimeRoot, 'artifacts');
const redisUrl = `redis://127.0.0.1:${redisPort}`;
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  REDIS_URL: redisUrl,
  EXECUTION_QUEUE_NAME: queueName,
  EXECUTION_QUEUE_ATTEMPTS: '2',
  EXECUTION_QUEUE_BACKOFF_MS: '500',
  EXECUTION_QUEUE_CONCURRENCY: '1',
  EXECUTION_QUEUE_HEARTBEAT_MS: '1000',
  EXECUTION_QUEUE_LEASE_MS: '8000',
  EXECUTION_QUEUE_SHUTDOWN_GRACE_MS: '5000',
  MAX_CONCURRENT_RUNS_PER_USER: '5',
  ARTIFACT_STORAGE_ROOT: artifactRoot,
  SSE_HEARTBEAT_MS: '5000',
  SSE_FALLBACK_POLL_MS: '500',
  CANCELLATION_CHECK_INTERVAL_MS: '500',
  BROWSER_USE_LOGGING_LEVEL: 'error',
};

Object.assign(process.env, childEnvironment);
await mkdir(artifactRoot, { recursive: true });

let redis: ManagedChild | undefined;
let dashboard: ManagedChild | undefined;
let worker: ManagedChild | undefined;
let queue: Queue | undefined;
const disposableUserIds = new Set<string>();

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function managedChild(
  command: string,
  args: string[],
  environment = childEnvironment
): ManagedChild {
  const child = spawn(command, args, {
    cwd: dashboardRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let recentOutput = '';
  const consume = (chunk: Buffer) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-100_000);
  };
  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);
  return { child, output: () => recentOutput };
}

async function stopChild(
  managed: ManagedChild | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
  timeoutMs = 15_000
) {
  if (!managed || managed.child.exitCode !== null) return;
  managed.child.kill(signal);
  const exited = await Promise.race([
    new Promise<boolean>((resolve) =>
      managed.child.once('exit', () => resolve(true))
    ),
    delay(timeoutMs).then(() => false),
  ]);
  if (!exited) {
    managed.child.kill('SIGKILL');
    await new Promise<void>((resolve) =>
      managed.child.once('exit', () => resolve())
    );
  }
}

async function waitFor(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 120_000,
  intervalMs = 200
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function portReady(host: string, readyPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: readyPort });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function startRedis() {
  redis = managedChild('redis-server', [
    '--bind',
    '127.0.0.1',
    '--port',
    String(redisPort),
    '--save',
    '',
    '--appendonly',
    'no',
    '--dir',
    runtimeRoot,
  ]);
  await waitFor(
    'isolated Redis',
    () => portReady('127.0.0.1', redisPort),
    15_000
  );
}

async function stopRedis() {
  await stopChild(redis);
  redis = undefined;
  await waitFor(
    'isolated Redis shutdown',
    async () => !(await portReady('127.0.0.1', redisPort)),
    10_000
  );
}

function startDashboard() {
  const next = path.join(
    dashboardRoot,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next'
  );
  dashboard = managedChild(process.execPath, [next, 'start', '-p', port]);
}

function startWorker() {
  worker = managedChild(process.execPath, [
    '--import',
    'tsx',
    'src/worker/browser-run-worker.ts',
  ]);
}

async function waitForDashboard() {
  await waitFor(
    'dashboard',
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

async function signUp(label = 'primary'): Promise<Session> {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email: `phase5-runtime-${label}-${nonce}@example.invalid`,
      password: `Phase5-${nonce}-disposable`,
      name: 'Phase 5 runtime verification',
    }),
  });
  if (!response.ok) throw new Error(`Sign-up returned ${response.status}.`);
  const payload = (await response.json()) as { user?: { id?: string } };
  const userId = payload.user?.id;
  const cookie = cookieHeader(response);
  if (!userId || !cookie) throw new Error('Sign-up returned no session.');
  disposableUserIds.add(userId);
  return { userId, cookie };
}

async function createAgent(
  session: Session,
  label: string,
  maxSteps: number,
  goal: string
): Promise<string> {
  const response = await fetch(`${origin}/api/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    },
    body: JSON.stringify({
      name: `Phase 5 ${label}`,
      description: 'Disposable Phase 5 verification agent',
      goal,
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      scheduleType: 'MANUAL',
      scheduleConfig: {},
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps,
        timeoutMs: 120_000,
        browserSettings: {
          headless: true,
          viewportWidth: 1024,
          viewportHeight: 720,
        },
      },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Agent creation returned ${response.status}.`);
  }
  const payload = (await response.json()) as { data?: { id?: string } };
  if (!payload.data?.id) throw new Error('Agent creation returned no ID.');
  return payload.data.id;
}

async function enqueue(session: Session, agentId: string): Promise<string> {
  const response = await fetch(`${origin}/api/agents/${agentId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    },
    body: '{}',
  });
  if (response.status !== 202) {
    throw new Error(`Run enqueue returned ${response.status}.`);
  }
  const payload = (await response.json()) as { data?: { runId?: string } };
  if (!payload.data?.runId) throw new Error('Run enqueue returned no ID.');
  return payload.data.runId;
}

async function cancel(session: Session, runId: string) {
  const startedAt = performance.now();
  const response = await fetch(`${origin}/api/runs/${runId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    },
    body: JSON.stringify({ reason: 'Disposable runtime verification' }),
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const payload = (await response.json()) as {
    code?: string;
    data?: { status?: string; cancelRequested?: boolean };
  };
  return {
    httpStatus: response.status,
    durationMs,
    code: payload.code,
    status: payload.data?.status,
    cancelRequested: payload.data?.cancelRequested,
  };
}

function parseFrame(value: string): SseFrame | null {
  let event = 'message';
  let id: number | undefined;
  const data: string[] = [];
  for (const line of value.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('id:')) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isSafeInteger(parsed)) id = parsed;
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, id, data: JSON.parse(data.join('\n')) };
}

async function readSseUntil(
  session: Session,
  runId: string,
  predicate: (frames: SseFrame[], frame: SseFrame) => boolean,
  lastEventId?: number,
  timeoutMs = 180_000
): Promise<SseFrame[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const frames: SseFrame[] = [];
  try {
    const response = await fetch(`${origin}/api/runs/${runId}/stream`, {
      headers: {
        Accept: 'text/event-stream',
        Cookie: session.cookie,
        ...(lastEventId === undefined
          ? {}
          : { 'Last-Event-ID': String(lastEventId) }),
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE returned ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder
        .decode(result.value, { stream: true })
        .replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const parsed = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) {
          frames.push(parsed);
          if (predicate(frames, parsed)) {
            controller.abort();
            return frames;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    return frames;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function chromiumPids(): Promise<number[]> {
  return (await snapshotLinuxProcesses())
    .filter(isPlaywrightChromium)
    .map((process) => process.pid)
    .sort((left, right) => left - right);
}

async function databaseCounts() {
  return {
    users: await prisma.user.count(),
    agents: await prisma.agent.count(),
    runs: await prisma.run.count(),
    events: await prisma.agentEvent.count(),
    artifacts: await prisma.runArtifact.count(),
  };
}

const before = await databaseCounts();
const report: Record<string, unknown> = {};

try {
  await startRedis();
  const queueConfiguration = getQueueConfiguration();
  queue = new Queue(queueName, {
    connection: queueConfiguration.workerConnection,
  });
  startDashboard();
  await waitForDashboard();
  const session = await signUp();
  const chromiumBefore = await chromiumPids();

  const queuedAgent = await createAgent(
    session,
    'queued cancellation',
    3,
    'Read the page heading and stop.'
  );
  const queuedRunId = await enqueue(session, queuedAgent);
  const queuedStream = readSseUntil(
    session,
    queuedRunId,
    (_frames, frame) => frame.event === 'stream-end',
    undefined,
    30_000
  );
  await delay(250);
  const queuedCancellation = await cancel(session, queuedRunId);
  const queuedFrames = await queuedStream;
  await delay(500);
  const queuedRun = await prisma.run.findUniqueOrThrow({
    where: { id: queuedRunId },
    include: { events: true },
  });
  const queuedJob = await queue.getJob(queuedRunId);
  if (
    queuedCancellation.httpStatus !== 200 ||
    queuedRun.status !== 'CANCELED' ||
    queuedRun.attempt !== 0 ||
    queuedJob ||
    queuedRun.events.filter((event) => event.type === 'RUN_CANCELED').length !==
      1
  ) {
    throw new Error('Queued cancellation contract failed.');
  }
  report.queuedCancellation = {
    api: queuedCancellation,
    finalStatus: queuedRun.status,
    attempts: queuedRun.attempt,
    cancellationEvents: queuedRun.events.filter(
      (event) => event.type === 'RUN_CANCELED'
    ).length,
    streamEvents: queuedFrames.map((frame) => frame.event),
  };

  startWorker();
  await waitFor(
    'worker readiness',
    async () => worker?.output().includes('Browser worker ready') ?? false,
    30_000
  );
  await delay(1_000);
  if (
    (await prisma.run.findUniqueOrThrow({ where: { id: queuedRunId } }))
      .attempt !== 0
  ) {
    throw new Error('Canceled queued run was claimed by the worker.');
  }

  const successAgent = await createAgent(
    session,
    'live success',
    4,
    'Open the page, read its main heading, and report that heading briefly.'
  );
  const successRunId = await enqueue(session, successAgent);
  const successFrames = await readSseUntil(
    session,
    successRunId,
    (_frames, frame) => frame.event === 'stream-end'
  );
  const successRun = await prisma.run.findUniqueOrThrow({
    where: { id: successRunId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
  if (successRun.status !== 'SUCCESS') {
    throw new Error(`Live success run ended as ${successRun.status}.`);
  }
  const successSequences = successFrames
    .filter((frame) => frame.event === 'agent-event')
    .flatMap((frame) => (frame.id === undefined ? [] : [frame.id]));
  if (
    successSequences.some(
      (sequence, index) =>
        index > 0 && sequence <= (successSequences[index - 1] ?? -1)
    )
  ) {
    throw new Error('SSE event sequences were not strictly ordered.');
  }
  report.liveSuccess = {
    status: successRun.status,
    eventCount: successRun.events.length,
    artifactCount: successRun.artifacts.length,
    streamedSequences: successSequences,
    streamedArtifacts: successFrames.filter(
      (frame) => frame.event === 'run-artifact'
    ).length,
    terminalClosed: successFrames.at(-1)?.event === 'stream-end',
  };
  if (process.env.ARTIFACT_STORAGE_DRIVER === 's3') {
    const artifact = successRun.artifacts[0];
    if (!artifact || artifact.storageProvider !== 'S3') {
      throw new Error('S3 runtime run did not persist an S3 artifact.');
    }
    const ownerResponse = await fetch(
      `${origin}/api/runs/${successRunId}/artifacts/${artifact.id}`,
      { headers: { Cookie: session.cookie } }
    );
    const otherSession = await signUp('other-owner');
    const crossUserResponse = await fetch(
      `${origin}/api/runs/${successRunId}/artifacts/${artifact.id}`,
      { headers: { Cookie: otherSession.cookie } }
    );
    const usageResponse = await fetch(`${origin}/api/usage/current`, {
      headers: { Cookie: session.cookie },
    });
    const usagePayload = (await usageResponse.json()) as {
      data?: {
        usage?: {
          runs?: string;
          attempts?: string;
          artifactBytes?: string;
          totalTokens?: string | null;
        };
      };
    };
    const usageRecordCount = await prisma.usageRecord.count({
      where: { runId: successRunId },
    });
    if (
      !ownerResponse.ok ||
      ownerResponse.headers.get('content-type') !== artifact.mimeType ||
      crossUserResponse.status !== 404 ||
      !usageResponse.ok ||
      BigInt(usagePayload.data?.usage?.runs ?? '0') < 2n ||
      BigInt(usagePayload.data?.usage?.attempts ?? '0') < 1n ||
      BigInt(usagePayload.data?.usage?.artifactBytes ?? '0') <
        BigInt(artifact.size) ||
      usageRecordCount < 5
    ) {
      throw new Error('Phase 6A storage or usage runtime contract failed.');
    }
    report.phase6a = {
      storageProvider: artifact.storageProvider,
      opaqueStorageKey: !artifact.storageKey.startsWith('http'),
      ownerStatus: ownerResponse.status,
      crossUserStatus: crossUserResponse.status,
      contentType: ownerResponse.headers.get('content-type'),
      usage: usagePayload.data?.usage,
      usageRecordCount,
    };
  }

  const cancelAgent = await createAgent(
    session,
    'running cancellation',
    20,
    'Inspect the page carefully, review all visible links, and summarize each visible section.'
  );
  const cancelRunId = await enqueue(session, cancelAgent);
  const firstConnection = await readSseUntil(
    session,
    cancelRunId,
    (_frames, frame) => frame.event === 'agent-event' && (frame.id ?? 0) >= 2,
    undefined,
    60_000
  );
  const cursor =
    firstConnection
      .filter((frame) => frame.id !== undefined)
      .map((frame) => frame.id as number)
      .at(-1) ?? 0;
  await waitFor('RUNNING cancellation fixture', async () => {
    const run = await prisma.run.findUnique({ where: { id: cancelRunId } });
    return run?.status === 'RUNNING' && run.heartbeatAt !== null;
  });
  await waitFor(
    'Chromium for cancellation fixture',
    async () =>
      (await chromiumPids()).some((pid) => !chromiumBefore.includes(pid)),
    60_000
  );

  const heartbeatBeforeRestart = await prisma.run.findUniqueOrThrow({
    where: { id: cancelRunId },
    select: { heartbeatAt: true },
  });
  await stopChild(dashboard);
  dashboard = undefined;
  await waitFor(
    'worker heartbeat after dashboard stop',
    async () => {
      const run = await prisma.run.findUnique({
        where: { id: cancelRunId },
        select: { heartbeatAt: true, status: true },
      });
      return Boolean(
        run?.status === 'RUNNING' &&
        run.heartbeatAt &&
        heartbeatBeforeRestart.heartbeatAt &&
        run.heartbeatAt > heartbeatBeforeRestart.heartbeatAt
      );
    },
    10_000
  );

  startDashboard();
  await waitForDashboard();
  const reconnected = readSseUntil(
    session,
    cancelRunId,
    (_frames, frame) => frame.event === 'stream-end',
    cursor,
    60_000
  );
  await delay(750);
  await stopRedis();
  const redisInterruptedAt = Date.now();
  const runningCancellation = await cancel(session, cancelRunId);
  await waitFor(
    'CANCELED running run via database fallback',
    async () =>
      (await prisma.run.findUnique({ where: { id: cancelRunId } }))?.status ===
      'CANCELED',
    30_000
  );
  const redisInterruptionMs = Date.now() - redisInterruptedAt;
  const reconnectFrames = await reconnected;
  await startRedis();
  await waitFor('worker Redis reconnection', async () => {
    try {
      await queue?.getJobCounts();
      return true;
    } catch {
      return false;
    }
  });
  await waitFor(
    'Chromium cleanup after cancellation',
    async () =>
      (await chromiumPids()).every((pid) => chromiumBefore.includes(pid)),
    30_000
  );
  const canceledRun = await prisma.run.findUniqueOrThrow({
    where: { id: cancelRunId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
  const replayedSequences = reconnectFrames
    .filter((frame) => frame.event === 'agent-event')
    .flatMap((frame) => (frame.id === undefined ? [] : [frame.id]));
  if (
    runningCancellation.httpStatus !== 202 ||
    canceledRun.status !== 'CANCELED' ||
    canceledRun.events.filter((event) => event.type === 'RUN_CANCELED')
      .length !== 1 ||
    canceledRun.events.some((event) =>
      ['RUN_COMPLETED', 'RUN_FAILED'].includes(event.type)
    ) ||
    replayedSequences.some((sequence) => sequence <= cursor) ||
    new Set(replayedSequences).size !== replayedSequences.length
  ) {
    throw new Error('Running cancellation or reconnect contract failed.');
  }
  report.runningCancellation = {
    api: runningCancellation,
    finalStatus: canceledRun.status,
    attempts: canceledRun.attempt,
    cancellationEvents: canceledRun.events.filter(
      (event) => event.type === 'RUN_CANCELED'
    ).length,
    terminalConflicts: canceledRun.events.filter((event) =>
      ['RUN_COMPLETED', 'RUN_FAILED'].includes(event.type)
    ).length,
    chromiumCleaned: true,
  };
  report.reconnect = {
    cursor,
    replayedSequences,
    duplicates: replayedSequences.length - new Set(replayedSequences).size,
    dashboardRestartHeartbeatContinued: true,
    terminalClosed: reconnectFrames.at(-1)?.event === 'stream-end',
  };
  report.redisInterruption = {
    durationMs: redisInterruptionMs,
    cancellationReachedWorker: true,
    sseFallbackReachedTerminal: reconnectFrames.at(-1)?.event === 'stream-end',
  };
} finally {
  await stopChild(dashboard);
  await stopChild(worker);
  if (queue) {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
  await stopChild(redis);
  for (const disposableUserId of disposableUserIds) {
    await prisma.user
      .delete({ where: { id: disposableUserId } })
      .catch(() => undefined);
  }
  await rm(runtimeRoot, { recursive: true, force: true });
}

const after = await databaseCounts();
const chromiumAfter = await chromiumPids();
await prisma.$disconnect();
console.info(
  JSON.stringify({
    ...report,
    cleanup: {
      before,
      after,
      countsRestored: JSON.stringify(before) === JSON.stringify(after),
      chromiumAfter,
    },
  })
);
