import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PrismaClient } from '@prisma/client';
import { RedisMemoryServer } from 'redis-memory-server';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const dashboardRoot = path.resolve(import.meta.dirname, '..');
const tsx = path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const next = path.join(
  dashboardRoot,
  'node_modules',
  'next',
  'dist',
  'bin',
  'next'
);
const baseUrl = 'http://localhost:3001';
const token = randomBytes(32).toString('base64url');
const marker = randomUUID().replaceAll('-', '');
const password = `Phase23-${marker}!aA1`;
const secretMarker = `phase23-secret-${marker}`;
const redis = await RedisMemoryServer.create();
const redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
const environment = {
  ...process.env,
  REDIS_URL: redisUrl,
  OBSERVABILITY_TOKEN: token,
  WORKER_BUILD_VERSION: 'phase23-runtime-dev',
  BROWSER_WORKER_CONCURRENCY: '1',
};

let devAll: ChildProcess | undefined;
let secondWorker: ChildProcess | undefined;
let production: ChildProcess | undefined;
let prisma: PrismaClient | undefined;
const userIds: string[] = [];
const processOutput = new WeakMap<ChildProcess, string>();

function database() {
  if (!prisma) throw new Error('Runtime database is not initialized.');
  return prisma;
}

function safeOutputTail(child: ChildProcess) {
  return (processOutput.get(child) ?? '')
    .replaceAll(token, '[REDACTED]')
    .replaceAll(secretMarker, '[REDACTED]')
    .slice(-4_000);
}

function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
  ipc = false
) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const capture = (chunk: Buffer | string) => {
    processOutput.set(
      child,
      `${processOutput.get(child) ?? ''}${String(chunk)}`.slice(-20_000)
    );
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  return child;
}

async function waitForProcessReady(
  child: ChildProcess,
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 600_000
) {
  await Promise.race([
    waitFor(predicate, message, timeoutMs),
    new Promise<never>((_, reject) => {
      child.once('exit', (code) =>
        reject(
          new Error(
            `${message} Process exited with ${code}.\n${safeOutputTail(child)}`
          )
        )
      );
    }),
  ]);
}

async function waitForSuccessfulExit(
  child: ChildProcess,
  message: string,
  timeoutMs = 600_000
) {
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `${message} Process exited with ${code}.\n${safeOutputTail(child)}`
              )
            )
      );
    }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref();
    }),
  ]);
}

async function forceStop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    await execFileAsync('taskkill.exe', [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ]).catch(() => undefined);
  else child.kill('SIGKILL');
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 300_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function request(pathname: string, init?: RequestInit) {
  return fetch(`${baseUrl}${pathname}`, init);
}

function tokenHeaders() {
  return { authorization: `Bearer ${token}` };
}

function cookie(response: Response) {
  const value = response.headers.get('set-cookie') ?? '';
  const match = /([^=;, ]*session[^=;, ]*)=([^;]+)/i.exec(value);
  if (!match) throw new Error('Disposable signup did not issue a session.');
  return `${match[1]}=${match[2]}`;
}

async function signup(plan: 'FREE' | 'PRO' | 'INTERNAL') {
  const email = `phase23-${plan.toLowerCase()}-${marker}@example.invalid`;
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: `Phase 23 ${plan}`, email, password }),
  });
  if (!response.ok)
    throw new Error(`${plan} signup returned ${response.status}.`);
  const user = await database().user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  if (plan !== 'FREE')
    await database().user.update({
      where: { id: user.id },
      data: { planCode: plan, planSource: 'MANUAL' },
    });
  return { userId: user.id, cookie: cookie(response) };
}

async function authorizedJson(pathname: string) {
  const response = await request(pathname, { headers: tokenHeaders() });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}.`);
  return response.json() as Promise<Record<string, any>>;
}

try {
  const shell = process.env.ComSpec ?? 'cmd.exe';
  devAll = spawnCommand(
    shell,
    ['/d', '/s', '/c', 'pnpm dev:all'],
    repositoryRoot
  );
  await waitForProcessReady(
    devAll,
    async () => (await request('/login')).status === 200,
    'dev:all dashboard did not become ready.'
  );
  const [databaseModule, persistenceModule, leaseModule, schedulerModule] =
    await Promise.all([
      import('../src/lib/db/prisma'),
      import('../src/lib/browser/run-persistence'),
      import('../src/lib/worker/run-lease'),
      import('../src/lib/scheduling/processor'),
    ]);
  prisma = databaseModule.prisma;
  const { PrismaRunPersistence } = persistenceModule;
  const { failClaimedRun, claimRun } = leaseModule;
  const { runSchedulerTick } = schedulerModule;

  const publicMetrics = await request('/api/internal/metrics');
  if (publicMetrics.status !== 404)
    throw new Error('Unauthenticated metrics access was not hidden.');
  const health = await request('/api/internal/health', {
    headers: tokenHeaders(),
  });
  const readiness = await request('/api/internal/readiness', {
    headers: tokenHeaders(),
  });
  if (health.status !== 200 || readiness.status !== 200)
    throw new Error('Protected health or readiness failed.');

  const free = await signup('FREE');
  const pro = await signup('PRO');
  const internal = await signup('INTERNAL');
  for (const account of [free, pro]) {
    const denied = await request('/api/internal/operations', {
      headers: { cookie: account.cookie },
    });
    if (denied.status !== 404)
      throw new Error('A customer plan reached internal operations.');
  }
  const internalAccess = await request('/api/internal/operations', {
    headers: { cookie: internal.cookie },
  });
  if (internalAccess.status !== 200)
    throw new Error('INTERNAL session was denied operations access.');

  const before = await authorizedJson('/api/internal/operations');
  const agent = await database().agent.create({
    data: {
      userId: internal.userId,
      name: 'Phase 23 metric fixture',
      goal: 'Disposable operational fixture',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {},
    },
  });
  const persistence = new PrismaRunPersistence();
  const successRun = await database().run.create({
    data: { agentId: agent.id, status: 'QUEUED', queuedAt: new Date() },
  });
  const successClaim = await claimRun(
    successRun.id,
    'phase23-fixture-success',
    20_000
  );
  if (!successClaim) throw new Error('Controlled success Run was not claimed.');
  await persistence.finalizeRun({
    runId: successRun.id,
    startedAt: successClaim.startedAt,
    status: 'SUCCESS',
    result: {
      durationMs: 10,
      summary: 'Controlled metric fixture.',
      visitedUrls: ['https://example.com/'],
    },
    events: [],
    artifacts: [],
  });
  const failedRun = await database().run.create({
    data: { agentId: agent.id, status: 'QUEUED', queuedAt: new Date() },
  });
  const failedClaim = await claimRun(
    failedRun.id,
    'phase23-fixture-failure',
    20_000
  );
  if (!failedClaim) throw new Error('Controlled failed Run was not claimed.');
  await failClaimedRun(
    failedRun.id,
    'phase23-fixture-failure',
    'CONTROLLED_RUNTIME_FAILURE',
    'The controlled runtime fixture failed safely.'
  );

  const freeAgent = await database().agent.create({
    data: {
      userId: free.userId,
      name: 'Phase 23 schedule block',
      goal: 'Disposable schedule block',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {},
    },
  });
  const due = new Date();
  await database().schedule.create({
    data: {
      userId: free.userId,
      agentId: freeAgent.id,
      kind: 'ONCE',
      timezone: 'UTC',
      oneTimeAt: due,
      nextRunAt: due,
    },
  });
  await runSchedulerTick(new Date());

  const notification = await database().notification.create({
    data: {
      userId: internal.userId,
      type: 'RUN_FAILED',
      title: 'Controlled fixture',
      payload: {},
      idempotencyKey: `phase23-notification-${marker}`,
    },
  });
  await database().notificationDelivery.create({
    data: {
      notificationId: notification.id,
      recipientEmail: `fixture-${marker}@example.invalid`,
      status: 'FAILED',
      attemptCount: 2,
      failureCode: 'CONTROLLED_FAILURE',
      failureMessage: 'Sanitized fixture failure.',
    },
  });
  const endpoint = await database().webhookEndpoint.create({
    data: {
      userId: internal.userId,
      name: 'Phase 23 fixture',
      url: 'https://example.com/webhook',
      eventTypes: ['run.failed'],
      secretCiphertext: secretMarker,
      secretIv: 'fixture',
      secretTag: 'fixture',
      secretPrefix: 'fixture',
    },
  });
  const webhookEvent = await database().webhookEvent.create({
    data: {
      userId: internal.userId,
      type: 'run.failed',
      payload: {},
      idempotencyKey: `phase23-webhook-${marker}`,
    },
  });
  await database().webhookDelivery.create({
    data: {
      eventId: webhookEvent.id,
      endpointId: endpoint.id,
      status: 'FAILED',
      attemptCount: 2,
      failureCode: 'REQUEST_TIMEOUT',
      durationMs: 25,
    },
  });
  await database().billingWebhookEvent.create({
    data: {
      id: `phase23-${marker}`,
      type: 'phase23.fixture',
      stripeCreatedAt: new Date(),
      processingState: 'FAILED',
      processedAt: new Date(),
      errorCode: 'CONTROLLED_FAILURE',
    },
  });

  secondWorker = spawnCommand(
    process.execPath,
    [tsx, 'src/worker/browser-run-worker.ts'],
    dashboardRoot,
    true
  );
  await waitFor(
    async () =>
      (await database().workerInstance.count({
        where: { status: 'ACTIVE', buildVersion: 'phase23-runtime-dev' },
      })) >= 2,
    'Second browser worker did not register ACTIVE.',
    60_000
  );

  for (let attempt = 0; attempt < 9; attempt += 1)
    await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        email: `rate-limit-${marker}@example.invalid`,
        password: 'invalid-password',
      }),
    });

  await new Promise((resolve) => setTimeout(resolve, 5_500));
  const metricsWithTwo = await request('/api/internal/metrics', {
    headers: tokenHeaders(),
  });
  const metricsText = await metricsWithTwo.text();
  const after = await authorizedJson('/api/internal/operations');
  const metricAssertions = {
    responseOk: metricsWithTwo.status === 200,
    successSeries: metricsText.includes(
      'runs_completed_total{status="success"}'
    ),
    failedSeries: metricsText.includes('runs_completed_total{status="failed"}'),
    twoWorkers: metricsText.includes(
      'browser_worker_instances{status="active"} 2'
    ),
    authRateLimit: metricsText.includes(
      'security_rejections_total{control="auth_rate_limit"}'
    ),
    secretAbsent: !metricsText.includes(secretMarker),
    successMoved: after.runs.totals.SUCCESS > before.runs.totals.SUCCESS,
    failedMoved: after.runs.totals.FAILED > before.runs.totals.FAILED,
  };
  if (Object.values(metricAssertions).some((passed) => !passed))
    throw new Error(
      `Runtime metrics assertions failed: ${JSON.stringify(metricAssertions)}`
    );

  secondWorker.send?.('browser-worker:shutdown');
  await waitFor(
    async () => secondWorker?.exitCode === 0,
    'Second browser worker did not drain cleanly.',
    20_000
  );
  await new Promise((resolve) => setTimeout(resolve, 5_500));
  const afterDrain = await authorizedJson('/api/internal/operations');
  if (afterDrain.workers.statuses.ACTIVE >= after.workers.statuses.ACTIVE)
    throw new Error('Worker drain was not reflected in fleet telemetry.');

  await forceStop(devAll);
  devAll = undefined;
  const productionBuild = spawnCommand(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', 'pnpm build'],
    dashboardRoot
  );
  await waitForSuccessfulExit(
    productionBuild,
    'Production dashboard rebuild did not complete.'
  );
  production = spawnCommand(
    process.execPath,
    [next, 'start', '-p', '3001'],
    dashboardRoot
  );
  await waitForProcessReady(
    production,
    async () => (await request('/login')).status === 200,
    'Production dashboard did not become ready.',
    60_000
  );
  const productionPublic = await request('/api/internal/metrics');
  const productionHealth = await request('/api/internal/health', {
    headers: tokenHeaders(),
  });
  if (productionPublic.status !== 404 || productionHealth.status !== 200)
    throw new Error(
      'Production observability protection differed from development.'
    );

  console.info(
    JSON.stringify({
      devAllReady: true,
      health: health.status,
      readiness: readiness.status,
      unauthenticatedMetrics: publicMetrics.status,
      freeDenied: true,
      proDenied: true,
      internalPermitted: true,
      successfulRunMetricMoved: true,
      failedRunMetricMoved: true,
      activeWorkersObserved: 2,
      workerDrainObserved: true,
      authRateLimitMetricObserved: true,
      schedulePlanBlockObserved:
        (after.scheduler.occurrences.PLAN_BLOCKED ?? 0) > 0,
      notificationFailureObserved:
        (after.notifications.statuses.FAILED ?? 0) > 0,
      webhookFailureObserved: (after.webhooks.statuses.FAILED ?? 0) > 0,
      billingFailureObserved: (after.billing.webhookStatuses.FAILED ?? 0) > 0,
      secretMarkerAbsent: !metricsText.includes(secretMarker),
      productionProtectionMatched: true,
    })
  );
} finally {
  await forceStop(secondWorker);
  await forceStop(devAll);
  await forceStop(production);
  if (typeof prisma !== 'undefined' && userIds.length)
    await database().user.deleteMany({ where: { id: { in: userIds } } });
  if (typeof prisma !== 'undefined') {
    await database().billingWebhookEvent.deleteMany({
      where: { id: { startsWith: 'phase23-' } },
    });
    await database().workerInstance.deleteMany({
      where: { buildVersion: 'phase23-runtime-dev' },
    });
    await database().$disconnect();
  }
  await redis.stop();
}
