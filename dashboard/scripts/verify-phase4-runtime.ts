import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { Queue } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import { prisma } from '../src/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { getQueueConfiguration } from '../src/lib/queue/config';

const execFileAsync = promisify(execFile);
const dashboardRoot = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(dashboardRoot, '..');
const port = 3001;
const origin = `http://localhost:${port}`;
const nonce = randomUUID();
const queueName = `phase4-http-restart-${nonce}`;
const artifactRoot = await mkdtemp(path.join(tmpdir(), 'phase4-runtime-'));
const redis = await RedisMemoryServer.create();
const redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_TRUSTED_ORIGINS: origin,
  REDIS_URL: redisUrl,
  EXECUTION_QUEUE_NAME: queueName,
  EXECUTION_QUEUE_ATTEMPTS: '1',
  EXECUTION_QUEUE_CONCURRENCY: '1',
  EXECUTION_QUEUE_HEARTBEAT_MS: '1000',
  EXECUTION_QUEUE_LEASE_MS: '5000',
  ARTIFACT_STORAGE_ROOT: artifactRoot,
  BROWSER_USE_LOGGING_LEVEL: 'error',
};

let dashboard: ChildProcess | undefined;
let worker: ChildProcess | undefined;
let userId: string | undefined;
let queue: Queue | undefined;

function startChild(kind: 'dashboard' | 'worker'): ChildProcess {
  const command =
    kind === 'dashboard'
      ? path.join(dashboardRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
      : path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const args =
    kind === 'dashboard'
      ? [command, 'dev', '-p', String(port)]
      : [command, 'src/worker/browser-run-worker.ts'];
  const child = spawn(process.execPath, args, {
    cwd: dashboardRoot,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let recentOutput = '';
  const consume = (chunk: Buffer) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-8000);
  };
  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);
  child.once('exit', () => {
    recentOutput = '';
  });
  return child;
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited && child.pid) {
    await execFileAsync('taskkill.exe', [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ]).catch(() => undefined);
  }
}

async function waitForHttp(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected while Next.js compiles.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Dashboard did not become ready.');
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

async function waitForRun(
  runId: string,
  predicate: (run: { status: string; heartbeatAt: Date | null }) => boolean,
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { status: true, heartbeatAt: true },
    });
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Run ${runId} did not reach the expected state.`);
}

async function chromiumProcessIds(): Promise<string[]> {
  const command =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|chromium)(\\.exe)?$' -and $_.CommandLine -match 'ms-playwright|playwright.*chromium|chrome-win' } | Select-Object -ExpandProperty ProcessId";
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', command],
    { windowsHide: true }
  );
  return stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

try {
  process.env.REDIS_URL = redisUrl;
  process.env.EXECUTION_QUEUE_NAME = queueName;
  const queueConfiguration = getQueueConfiguration();
  queue = new Queue(queueName, {
    connection: queueConfiguration.workerConnection,
  });
  const chromiumBefore = await chromiumProcessIds();

  dashboard = startChild('dashboard');
  await waitForHttp();

  const email = `phase4-runtime-${nonce}@example.invalid`;
  const password = `Phase4-${nonce}-safe-test`;
  const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email,
      password,
      name: 'Phase 4 runtime verification',
    }),
  });
  if (!signUp.ok) throw new Error(`Sign-up failed with HTTP ${signUp.status}.`);
  const cookie = cookieHeader(signUp);
  const account = (await signUp.json()) as { user?: { id?: string } };
  userId = account.user?.id;
  if (!userId || !cookie) throw new Error('Sign-up did not create a session.');

  const createAgent = await fetch(`${origin}/api/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify({
      name: 'Phase 4 HTTP restart drill',
      description: 'Disposable closure verification',
      goal: 'Open the page and report its title.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      scheduleType: 'MANUAL',
      scheduleConfig: {},
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
    }),
  });
  if (createAgent.status !== 201) {
    throw new Error(`Agent creation failed with HTTP ${createAgent.status}.`);
  }
  const agentPayload = (await createAgent.json()) as {
    data?: { id?: string };
  };
  const agentId = agentPayload.data?.id;
  if (!agentId) throw new Error('Agent creation did not return an ID.');

  const enqueueStarted = performance.now();
  const enqueueResponse = await fetch(`${origin}/api/agents/${agentId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: origin,
    },
    body: '{}',
  });
  const enqueueMs = Math.round(performance.now() - enqueueStarted);
  if (enqueueResponse.status !== 202) {
    throw new Error(`Run enqueue returned HTTP ${enqueueResponse.status}.`);
  }
  const enqueuePayload = (await enqueueResponse.json()) as {
    data?: { runId?: string };
  };
  const runId = enqueuePayload.data?.runId;
  if (!runId) throw new Error('Run enqueue did not return a Run ID.');

  const queued = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const queuedJob = await queue.getJob(runId);
  const chromiumAfterEnqueue = await chromiumProcessIds();
  if (
    queued.status !== 'QUEUED' ||
    queued.attempt !== 0 ||
    !queuedJob ||
    chromiumAfterEnqueue.some((id) => !chromiumBefore.includes(id))
  ) {
    throw new Error(
      `Authenticated enqueue was not cleanly decoupled: ${JSON.stringify({
        runStatus: queued.status,
        attempt: queued.attempt,
        bullJobPresent: Boolean(queuedJob),
        chromiumBefore,
        chromiumAfterEnqueue,
      })}`
    );
  }

  worker = startChild('worker');
  const running = await waitForRun(
    runId,
    (run) => run.status === 'RUNNING' && run.heartbeatAt !== null
  );
  const firstHeartbeat = running.heartbeatAt;
  await stopChild(dashboard);
  dashboard = undefined;
  const heartbeatObservation = await waitForRun(
    runId,
    (run) =>
      run.status !== 'RUNNING' ||
      (firstHeartbeat !== null &&
        run.heartbeatAt !== null &&
        run.heartbeatAt > firstHeartbeat),
    10_000
  );
  const heartbeatContinued =
    firstHeartbeat !== null &&
    heartbeatObservation.heartbeatAt !== null &&
    heartbeatObservation.heartbeatAt > firstHeartbeat;

  await waitForRun(runId, (run) =>
    ['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(run.status)
  );
  const completed = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    include: {
      events: { orderBy: { sequence: 'asc' } },
      artifacts: true,
    },
  });
  if (completed.status !== 'SUCCESS') {
    throw new Error(`Dashboard restart drill ended with ${completed.status}.`);
  }

  dashboard = startChild('dashboard');
  await waitForHttp();
  const runApiResponse = await fetch(`${origin}/api/runs/${runId}`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  const detailPageResponse = await fetch(`${origin}/dashboard/runs/${runId}`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  let artifactReadable = completed.artifacts.length === 0;
  if (completed.artifacts[0]) {
    const artifactResponse = await fetch(
      `${origin}/api/runs/${runId}/artifacts/${completed.artifacts[0].id}`,
      { headers: { Cookie: cookie, Origin: origin } }
    );
    artifactReadable =
      artifactResponse.ok &&
      artifactResponse.headers.get('content-type')?.startsWith('image/') ===
        true;
  }
  if (!runApiResponse.ok || !detailPageResponse.ok || !artifactReadable) {
    throw new Error('Run details were not readable after dashboard restart.');
  }

  const sequences = completed.events.map((event) => event.sequence);
  console.info(
    JSON.stringify({
      httpStatus: enqueueResponse.status,
      enqueueMs,
      queuedBeforeWorker: true,
      bullJobPresent: true,
      chromiumStartedInApi: false,
      dashboardStoppedWhileRunning: true,
      heartbeatContinued,
      finalStatus: completed.status,
      attempt: completed.attempt,
      eventCount: completed.events.length,
      eventSequenceUnique: new Set(sequences).size === sequences.length,
      artifactCount: completed.artifacts.length,
      runApiAfterRestart: runApiResponse.status,
      detailPageAfterRestart: detailPageResponse.status,
      artifactReadable,
    })
  );
} finally {
  await stopChild(dashboard);
  await stopChild(worker);
  await queue?.close().catch(() => undefined);
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.stop();
  await rm(artifactRoot, { recursive: true, force: true });
}
