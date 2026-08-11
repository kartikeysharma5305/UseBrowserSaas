import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { RedisMemoryServer } from 'redis-memory-server';

import {
  findPostgresTool,
  parsePostgresUrl,
  postgresEnvironment,
  runNative,
} from '../src/lib/disaster-recovery/postgres';
import { verifyDatabaseBackup } from '../src/lib/disaster-recovery/manifest';

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(dashboardRoot, '..');
const tsx = path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const next = path.join(
  dashboardRoot,
  'node_modules',
  'next',
  'dist',
  'bin',
  'next'
);
const sourceUrl = process.env.DATABASE_URL?.trim();
if (!sourceUrl)
  throw new Error(
    'DATABASE_URL is required to create an isolated staging database.'
  );
const marker = randomUUID().replaceAll('-', '').toLowerCase();
const databaseName = `phase26_${marker.slice(0, 20)}`;
const source = parsePostgresUrl(sourceUrl);
const database = new URL(source.url);
database.pathname = `/${databaseName}`;
database.search = '';
const admin = new URL(source.url);
admin.pathname = '/postgres';
admin.search = '';
const databaseUrl = database.toString();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase26-staging-'));
const artifacts = path.join(workspace, 'artifacts');
const backup = path.join(workspace, 'staging.dump');
const redis = await RedisMemoryServer.create();
const redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
const baseUrl = 'http://localhost:3012';
const password = `Phase26-${marker}!aA1`;
const email = `phase26-${marker}@example.invalid`;
const operatorToken = randomBytes(32).toString('base64url');
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'staging',
  DEPLOYMENT_INSTANCE_ID: `phase26-${marker.slice(0, 12)}`,
  STAGING_LOCAL_DRILL: 'true',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_BASE_URL: baseUrl,
  NEXT_PUBLIC_APP_URL: baseUrl,
  BETTER_AUTH_URL: baseUrl,
  BETTER_AUTH_TRUSTED_ORIGINS: baseUrl,
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
  API_KEY_PEPPER: randomBytes(32).toString('base64url'),
  WEBHOOK_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OBSERVABILITY_TOKEN: operatorToken,
  EXECUTION_ENABLED: 'true',
  GROQ_API_KEY:
    process.env.GROQ_API_KEY || 'staging-drill-invalid-provider-key',
  ARTIFACT_STORAGE_DRIVER: 'local',
  ARTIFACT_STORAGE_ROOT: artifacts,
  BILLING_ENABLED: 'false',
  EMAIL_ENABLED: 'true',
  EMAIL_PROVIDER: 'development',
  EMAIL_FROM: 'Browser Use Staging <notifications@example.invalid>',
  STAGING_EMAIL_MODE: 'sandbox',
  WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS: 'false',
  BROWSER_WORKER_CONCURRENCY: '1',
  WORKER_BUILD_VERSION: 'phase26-staging-drill',
};
Object.assign(process.env, environment);

const children: ChildProcess[] = [];
const output = new WeakMap<ChildProcess, string>();
let prisma: PrismaClient | undefined;

function start(args: string[], ipc = false) {
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: dashboardRoot,
    env: environment,
    windowsHide: true,
    stdio: (ipc
      ? ['ignore', 'pipe', 'pipe', 'ipc']
      : ['ignore', 'pipe', 'pipe']) as any,
  });
  const capture = (chunk: Buffer | string) =>
    output.set(
      child,
      `${output.get(child) ?? ''}${String(chunk)}`.slice(-8_000)
    );
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  children.push(child);
  return child;
}

async function stop(child: ChildProcess, gracefulBrowser = false) {
  if (!child.pid || child.exitCode !== null) return;
  if (gracefulBrowser && child.connected) {
    child.send('browser-worker:shutdown');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 45_000)),
    ]);
  }
  if (child.exitCode !== null) return;
  if (process.platform === 'win32')
    await runNative('taskkill.exe', [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ]).catch(() => undefined);
  else child.kill('SIGTERM');
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  timeout = 120_000
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready.`);
}

function sessionCookie(response: Response) {
  const header = response.headers.get('set-cookie') ?? '';
  const match = /([^=;, ]*session[^=;, ]*)=([^;]+)/i.exec(header);
  if (!match) throw new Error('Authentication did not issue a session.');
  return `${match[1]}=${match[2]}`;
}

async function request(
  pathname: string,
  cookie?: string,
  init: RequestInit = {}
) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(init.method && init.method !== 'GET'
        ? { origin: baseUrl, 'content-type': 'application/json' }
        : {}),
      ...init.headers,
    },
  });
}

try {
  await runNative(findPostgresTool('createdb'), [databaseName], {
    env: postgresEnvironment(admin.toString()),
  });
  await runNative(
    process.execPath,
    [process.env.npm_execpath!, 'exec', 'prisma', 'migrate', 'deploy'],
    { cwd: dashboardRoot, env: environment }
  );
  await runNative(process.execPath, [tsx, 'scripts/production-preflight.ts'], {
    cwd: dashboardRoot,
    env: environment,
  });

  const server = start([next, 'start', '-p', '3012']);
  await waitFor(async () => {
    if (server.exitCode !== null)
      throw new Error(
        `Staging web exited early: ${(output.get(server) ?? '').slice(-2_000)}`
      );
    const response = await request('/api/internal/readiness', undefined, {
      headers: { authorization: `Bearer ${operatorToken}` },
    }).catch(() => null);
    return response?.status === 200;
  }, 'Staging dashboard');

  const browser = start([tsx, 'src/worker/browser-run-worker.ts'], true);
  start([tsx, 'src/worker/schedule-worker.ts']);
  start([tsx, 'src/worker/notification-worker.ts']);
  start([tsx, 'src/worker/webhook-worker.ts']);
  const databaseModule = await import('../src/lib/db/prisma');
  prisma = databaseModule.prisma;
  await waitFor(
    async () =>
      (await prisma!.workerInstance.count({ where: { status: 'ACTIVE' } })) >=
      1,
    'Browser worker'
  );
  const heartbeatModule = await import('../src/lib/operations/heartbeats');
  await waitFor(async () => {
    const values = await heartbeatModule.readOperationalHeartbeats();
    return Object.values(values).every(Boolean);
  }, 'Operational workers');

  const signup = await request('/api/auth/sign-up/email', undefined, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Phase 26 staging operator',
      email,
      password,
    }),
  });
  if (!signup.ok) throw new Error('Staging signup failed.');
  const signupCookie = sessionCookie(signup);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({
    where: { id: user.id },
    data: { planCode: 'INTERNAL', planSource: 'INTERNAL' },
  });
  const login = await request('/api/auth/sign-in/email', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error('Staging login failed.');
  const cookie = sessionCookie(login) || signupCookie;

  const createAgent = await request('/api/agents', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Phase 26 safe Agent',
      goal: 'Open the page and report its title. Do not interact with forms.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {
        model: 'groq_llama-3.3-70b-versatile',
        maxSteps: 2,
        timeoutMs: 30000,
        browserSettings: {
          headless: true,
          viewportWidth: 1024,
          viewportHeight: 768,
        },
      },
    }),
  });
  if (createAgent.status !== 201)
    throw new Error('Staging Agent creation failed.');
  const agentId = ((await createAgent.json()) as any).data.id as string;
  const runResponse = await request(`/api/agents/${agentId}/run`, cookie, {
    method: 'POST',
    body: JSON.stringify({ variables: {} }),
  });
  if (runResponse.status !== 202) throw new Error('Safe Run was not admitted.');
  const runId = ((await runResponse.json()) as any).data.runId as string;
  await waitFor(
    async () => {
      const run = await prisma!.run.findUnique({ where: { id: runId } });
      return Boolean(
        run &&
        run.attempt > 0 &&
        ['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(run.status)
      );
    },
    'Safe browser Run',
    180_000
  );

  const schedule = await request('/api/schedules', cookie, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      kind: 'DAILY',
      timezone: 'UTC',
      localTime: '23:59',
    }),
  });
  if (schedule.status !== 201)
    throw new Error('Staging schedule creation failed.');
  const usage = await request('/api/usage/current', cookie);
  if (!usage.ok) throw new Error('Staging usage accounting was unavailable.');

  const apiKeyResponse = await request('/api/api-keys', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Staging smoke key',
      scopes: ['agents:read'],
    }),
  });
  if (apiKeyResponse.status !== 201)
    throw new Error('Staging API key creation failed.');
  const apiKeyData = ((await apiKeyResponse.json()) as any).data;
  const publicApi = await request('/api/v1/agents', undefined, {
    headers: { authorization: `Bearer ${apiKeyData.key}` },
  });
  if (!publicApi.ok) throw new Error('Staging public API key was unusable.');
  const revoked = await request(`/api/api-keys/${apiKeyData.id}`, cookie, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  if (!revoked.ok) throw new Error('Staging API key revocation failed.');

  const webhook = await request('/api/webhooks', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Staging safe receiver',
      url: 'https://example.com/browser-use-staging-webhook',
      eventTypes: ['run.succeeded'],
    }),
  });
  if (webhook.status !== 201)
    throw new Error('Staging webhook fixture failed.');
  const webhookId = ((await webhook.json()) as any).data.id as string;
  const webhookTest = await request(`/api/webhooks/${webhookId}/test`, cookie, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (webhookTest.status !== 202)
    throw new Error('Staging webhook test was not queued.');
  await waitFor(
    async () =>
      (await prisma!.webhookDelivery.count({
        where: { endpointId: webhookId, attemptCount: { gt: 0 } },
      })) > 0,
    'Webhook worker fixture'
  );

  const notifications = await import('../src/lib/notifications/service');
  const notification = await notifications.emitNotification({
    userId: user.id,
    type: 'ACCOUNT_DELETION_BLOCKED',
    idempotencyKey: `phase26:${marker}:notification`,
    mandatory: true,
    payload: { actionPath: '/dashboard/settings' },
  });
  await waitFor(async () => {
    if (!notification?.deliveryId) return false;
    return (
      (
        await prisma!.notificationDelivery.findUnique({
          where: { id: notification.deliveryId },
          select: { status: true },
        })
      )?.status === 'SENT'
    );
  }, 'Safe staging notification');

  for (const page of [
    '/',
    '/login',
    '/privacy',
    '/terms',
    '/acceptable-use',
    '/cookies',
  ])
    if ((await request(page)).status !== 200)
      throw new Error(`Staging page ${page} failed.`);
  if ((await request('/api/internal/metrics')).status !== 404)
    throw new Error('Metrics were publicly accessible.');
  if (
    (
      await request('/api/internal/metrics', undefined, {
        headers: { authorization: `Bearer ${operatorToken}` },
      })
    ).status !== 200
  )
    throw new Error('Protected metrics were unavailable.');

  await runNative(
    process.execPath,
    [tsx, 'scripts/backup-database.ts', '--output', backup],
    { cwd: dashboardRoot, env: environment }
  );
  await verifyDatabaseBackup(`${backup}.manifest.json`);
  const exported = await request('/api/account/export', cookie, {
    method: 'POST',
    body: '{}',
  });
  if (!exported.ok) throw new Error('Staging data export failed.');
  const deletion = await request('/api/account/delete', cookie, {
    method: 'POST',
    body: JSON.stringify({ confirmation: 'DELETE' }),
  });
  if (deletion.status !== 202)
    throw new Error('Disposable account deletion failed.');
  if (
    (
      await request('/api/account/export', cookie, {
        method: 'POST',
        body: '{}',
      })
    ).status !== 401
  )
    throw new Error('Deleted staging session remained usable.');

  await stop(browser, true);
  const stoppedWorker = await prisma.workerInstance.count({
    where: { status: 'STOPPED' },
  });
  if (stoppedWorker < 1)
    throw new Error('Browser worker did not drain cleanly.');
  console.info(
    JSON.stringify({
      isolatedDatabase: true,
      isolatedRedis: true,
      isolatedArtifacts: true,
      migrationsApplied: true,
      productionBuildStarted: true,
      webReady: true,
      browserWorkerExecutedSafeRun: true,
      schedulerHeartbeat: true,
      notificationDeliveredInSandbox: true,
      webhookAttempted: true,
      publicApiLifecycle: true,
      usageAccounting: true,
      metricsProtected: true,
      backupVerified: true,
      accountDeletionVerified: true,
      browserWorkerDrained: true,
    })
  );
} finally {
  for (const child of [...children].reverse()) await stop(child);
  await prisma?.$disconnect();
  await redis.stop();
  await runNative(findPostgresTool('dropdb'), ['--if-exists', databaseName], {
    env: postgresEnvironment(admin.toString()),
  }).catch(() => undefined);
  await fs.rm(workspace, { recursive: true, force: true });
}
