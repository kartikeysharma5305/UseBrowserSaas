import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';

import { LocalArtifactStorage } from '../src/lib/browser/artifact-storage';
import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';
import {
  copyLocalArtifactBackup,
  verifyArtifactObjects,
} from '../src/lib/disaster-recovery/artifacts';
import { verifyDatabaseBackup } from '../src/lib/disaster-recovery/manifest';
import {
  findPostgresTool,
  parsePostgresUrl,
  postgresEnvironment,
  runNative,
} from '../src/lib/disaster-recovery/postgres';
import {
  protectSigningSecret,
  revealSigningSecret,
} from '../src/lib/webhooks/crypto';

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
if (!sourceUrl) throw new Error('DATABASE_URL is required.');
const marker = randomUUID().replaceAll('-', '').toLowerCase();
const targetDatabase = `phase24_${marker.slice(0, 20)}`;
const sourceParsed = parsePostgresUrl(sourceUrl);
const target = new URL(sourceParsed.url);
target.pathname = `/${targetDatabase}`;
target.search = '';
const targetUrl = target.toString();
const admin = new URL(sourceParsed.url);
admin.pathname = '/postgres';
admin.search = '';
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase24-runtime-'));
const archive = path.join(workspace, 'database.dump');
const manifestPath = `${archive}.manifest.json`;
const artifactBackupRoot = path.join(workspace, 'artifacts-restored');
const redis = await RedisMemoryServer.create();
const redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
const operatorToken = randomBytes(32).toString('base64url');
const originalWebhookKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
const source = new PrismaClient();
let restored: PrismaClient | undefined;
let server: ChildProcess | undefined;
let fixtureUserId: string | undefined;
let fixtureArtifactKey: string | undefined;
let sourceStorage: LocalArtifactStorage | undefined;

function spawnServer() {
  return spawn(process.execPath, [next, 'start', '-p', '3011'], {
    cwd: dashboardRoot,
    env: {
      ...process.env,
      DATABASE_URL: targetUrl,
      REDIS_URL: redisUrl,
      OBSERVABILITY_TOKEN: operatorToken,
      ARTIFACT_STORAGE_DRIVER: 'local',
      ARTIFACT_STORAGE_ROOT: artifactBackupRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function stop(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    await runNative('taskkill.exe', [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ]).catch(() => undefined);
  else child.kill('SIGTERM');
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      'http://localhost:3011/api/internal/readiness',
      {
        headers: { authorization: `Bearer ${operatorToken}` },
      }
    ).catch(() => null);
    if (response?.status === 200) return response;
    if (server?.exitCode !== null)
      throw new Error('Restored dashboard exited before readiness.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Restored dashboard did not become ready.');
}

try {
  if (!originalWebhookKey)
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY is required for the drill.');
  const storage = createArtifactStorage();
  if (!(storage instanceof LocalArtifactStorage))
    throw new Error(
      'The disposable Phase 24 drill requires local artifact storage.'
    );
  sourceStorage = storage;

  const user = await source.user.create({
    data: {
      email: `phase24-${marker}@example.invalid`,
      name: 'Phase 24 disposable restore',
      emailVerified: true,
      planCode: 'INTERNAL',
      planSource: 'INTERNAL',
    },
  });
  fixtureUserId = user.id;
  const agent = await source.agent.create({
    data: {
      userId: user.id,
      name: 'Phase 24 disposable Agent',
      goal: 'Verify backup and restore integrity',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {},
    },
  });
  const completed = await source.run.create({
    data: {
      agentId: agent.id,
      status: 'SUCCESS',
      queuedAt: new Date(Date.now() - 2_000),
      startedAt: new Date(Date.now() - 1_000),
      completedAt: new Date(),
      duration: 1_000,
      attempt: 1,
      result: { summary: 'Disposable restore fixture' },
      events: {
        create: {
          sequence: 1,
          type: 'RUN_COMPLETED',
          message: 'Disposable Run completed.',
          data: { success: true },
        },
      },
    },
  });
  const queued = await source.run.create({
    data: { agentId: agent.id, status: 'QUEUED', queuedAt: new Date() },
  });
  await source.usageRecord.create({
    data: {
      userId: user.id,
      runId: completed.id,
      attempt: 1,
      type: 'RUN_SUCCEEDED',
      quantity: 1n,
      unit: 'COUNT',
      measurement: 'EXACT',
      idempotencyKey: `phase24:${marker}:usage`,
      periodStart: new Date(Date.now() - 1_000),
      periodEnd: new Date(Date.now() + 1_000),
    },
  });
  const schedule = await source.schedule.create({
    data: {
      userId: user.id,
      agentId: agent.id,
      kind: 'ONCE',
      timezone: 'UTC',
      oneTimeAt: new Date(Date.now() + 86_400_000),
      nextRunAt: new Date(Date.now() + 86_400_000),
    },
  });
  const notification = await source.notification.create({
    data: {
      userId: user.id,
      runId: completed.id,
      type: 'RUN_SUCCEEDED',
      title: 'Disposable recovery notification',
      payload: {},
      idempotencyKey: `phase24:${marker}:notification`,
    },
  });
  const notificationDelivery = await source.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      recipientEmail: `phase24-${marker}@example.invalid`,
    },
  });
  const secret = `phase24-${marker}`;
  const protectedSecret = protectSigningSecret(secret);
  const endpoint = await source.webhookEndpoint.create({
    data: {
      userId: user.id,
      name: 'Phase 24 disposable endpoint',
      url: 'https://example.com/recovery-hook',
      eventTypes: ['run.completed'],
      ...protectedSecret,
    },
  });
  const webhookEvent = await source.webhookEvent.create({
    data: {
      userId: user.id,
      runId: completed.id,
      type: 'run.completed',
      payload: {},
      idempotencyKey: `phase24:${marker}:webhook`,
    },
  });
  const webhookDelivery = await source.webhookDelivery.create({
    data: { eventId: webhookEvent.id, endpointId: endpoint.id },
  });
  const saved = await storage.save({
    runId: completed.id,
    fileName: 'phase24.png',
    mimeType: 'image/png',
    data: Buffer.from('phase24-disposable-artifact'),
  });
  fixtureArtifactKey = saved.storageKey;
  const artifact = await source.runArtifact.create({
    data: {
      runId: completed.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      ...saved,
    },
  });

  await runNative(
    process.execPath,
    [
      tsx,
      '--env-file=.env',
      '--env-file=.env.local',
      'scripts/backup-database.ts',
      '--output',
      archive,
    ],
    { cwd: dashboardRoot, env: { ...process.env, DATABASE_URL: sourceUrl } }
  );
  const verified = await verifyDatabaseBackup(manifestPath);
  const corruptArchive = path.join(workspace, 'corrupt.dump');
  const corruptManifest = `${corruptArchive}.manifest.json`;
  await fs.copyFile(archive, corruptArchive);
  await fs.appendFile(corruptArchive, 'corrupt');
  const corruptData = {
    ...verified.manifest,
    archive: {
      ...verified.manifest.archive,
      file: path.basename(corruptArchive),
    },
  };
  await fs.writeFile(corruptManifest, JSON.stringify(corruptData));
  let corruptionRejected = false;
  try {
    await verifyDatabaseBackup(corruptManifest);
  } catch {
    corruptionRejected = true;
  }
  if (!corruptionRejected) throw new Error('Corrupt backup was accepted.');

  await copyLocalArtifactBackup({
    storage,
    destination: artifactBackupRoot,
    objects: [
      {
        artifactId: artifact.id,
        storageKey: artifact.storageKey,
        size: artifact.size,
        checksum: artifact.checksum,
      },
    ],
  });
  const restoredStorage = new LocalArtifactStorage(artifactBackupRoot);
  const artifactObjects = [
    {
      artifactId: artifact.id,
      storageKey: artifact.storageKey,
      size: artifact.size,
      checksum: artifact.checksum,
    },
  ];
  await restoredStorage.delete(artifact.storageKey);
  const missingReport = await verifyArtifactObjects({
    storage: restoredStorage,
    objects: artifactObjects,
    verifyChecksum: true,
  });
  if (missingReport.missing.length !== 1)
    throw new Error('Missing artifact was not detected.');
  const artifactData = await storage.read(artifact.storageKey);
  const artifactTarget = path.join(
    artifactBackupRoot,
    ...artifact.storageKey.split('/')
  );
  await fs.mkdir(path.dirname(artifactTarget), { recursive: true });
  await fs.writeFile(artifactTarget, artifactData);
  const restoredArtifactReport = await verifyArtifactObjects({
    storage: restoredStorage,
    objects: artifactObjects,
    verifyChecksum: true,
  });
  if (restoredArtifactReport.present !== 1)
    throw new Error('Restored artifact failed verification.');

  await runNative(findPostgresTool('createdb'), [targetDatabase], {
    env: postgresEnvironment(admin.toString()),
  });
  await runNative(
    process.execPath,
    [
      tsx,
      '--env-file=.env',
      '--env-file=.env.local',
      'scripts/restore-database.ts',
      '--manifest',
      manifestPath,
      '--confirm-empty-target',
    ],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        DATABASE_URL: sourceUrl,
        RESTORE_DATABASE_URL: targetUrl,
      },
    }
  );
  restored = new PrismaClient({ datasourceUrl: targetUrl });
  const restoredUser = await restored.user.findUnique({
    where: { id: user.id },
  });
  const restoredAgent = await restored.agent.findUnique({
    where: { id: agent.id },
  });
  const restoredRun = await restored.run.findUnique({
    where: { id: completed.id },
    include: { events: true, artifacts: true, usageRecords: true },
  });
  const restoredSchedule = await restored.schedule.findUnique({
    where: { id: schedule.id },
  });
  const restoredNotification = await restored.notificationDelivery.findUnique({
    where: { id: notificationDelivery.id },
  });
  const restoredWebhook = await restored.webhookDelivery.findUnique({
    where: { id: webhookDelivery.id },
  });
  if (
    !restoredUser ||
    !restoredAgent ||
    restoredRun?.events.length !== 1 ||
    restoredRun.artifacts.length !== 1 ||
    restoredRun.usageRecords.length !== 1 ||
    !restoredSchedule ||
    !restoredNotification ||
    !restoredWebhook
  )
    throw new Error('Restored relational fixture is incomplete.');

  const restoredEndpoint = await restored.webhookEndpoint.findUniqueOrThrow({
    where: { id: endpoint.id },
  });
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
  let wrongKeyRejected = false;
  try {
    revealSigningSecret(restoredEndpoint);
  } catch {
    wrongKeyRejected = true;
  }
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookKey;
  if (!wrongKeyRejected || revealSigningSecret(restoredEndpoint) !== secret)
    throw new Error('Webhook secret continuity drill failed.');

  await runNative(
    process.execPath,
    [
      tsx,
      '--env-file=.env',
      '--env-file=.env.local',
      'scripts/reconcile-all.ts',
    ],
    {
      cwd: dashboardRoot,
      env: { ...process.env, DATABASE_URL: targetUrl, REDIS_URL: redisUrl },
    }
  );
  const redisConnection = {
    host: await redis.getHost(),
    port: await redis.getPort(),
  };
  const queues = [
    new Queue(process.env.EXECUTION_QUEUE_NAME || 'browser-agent-runs', {
      connection: redisConnection,
    }),
    new Queue(
      process.env.NOTIFICATION_QUEUE_NAME || 'notification-deliveries',
      { connection: redisConnection }
    ),
    new Queue(process.env.WEBHOOK_QUEUE_NAME || 'outbound-webhook-deliveries', {
      connection: redisConnection,
    }),
  ];
  const jobs = await Promise.all([
    queues[0].getJob(queued.id),
    queues[1].getJob(notificationDelivery.id),
    queues[2].getJob(webhookDelivery.id),
  ]);
  if (jobs.some((job) => !job))
    throw new Error('Durable queue reconciliation was incomplete.');
  await runNative(
    process.execPath,
    [
      tsx,
      '--env-file=.env',
      '--env-file=.env.local',
      'scripts/reconcile-all.ts',
    ],
    {
      cwd: dashboardRoot,
      env: { ...process.env, DATABASE_URL: targetUrl, REDIS_URL: redisUrl },
    }
  );
  const repeatedCounts = await Promise.all(
    queues.map((queue) => queue.count())
  );
  if (repeatedCounts.some((count) => count < 1))
    throw new Error('Repeated queue reconciliation was not idempotent.');
  await Promise.all(queues.map((queue) => queue.close()));

  server = spawnServer();
  server.stdout?.resume();
  server.stderr?.resume();
  const readiness = await waitForReady();
  const health = await fetch('http://localhost:3011/api/internal/health', {
    headers: { authorization: `Bearer ${operatorToken}` },
  });
  if (health.status !== 200 || readiness.status !== 200)
    throw new Error('Restored application health verification failed.');

  console.info(
    JSON.stringify({
      databaseBackupVerified: true,
      corruptionRejected,
      separateDatabaseRestored: true,
      userRestored: true,
      agentRestored: true,
      runEventsUsageRestored: true,
      scheduleRestored: true,
      deliveryMetadataRestored: true,
      artifactMetadataMapped: true,
      missingArtifactDetected: true,
      artifactRestoredAndVerified: true,
      wrongEncryptionKeyRejected: true,
      correctEncryptionKeyRecovered: true,
      emptyRedisQueuesReconciled: true,
      repeatedReconciliationSafe: true,
      restoredHealth: health.status,
      restoredReadiness: readiness.status,
      authenticatedFixtureAccess:
        'not-exercised-no-password-credential-created',
    })
  );
} finally {
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookKey;
  await stop(server);
  await restored?.$disconnect().catch(() => undefined);
  await runNative(findPostgresTool('dropdb'), ['--if-exists', targetDatabase], {
    env: postgresEnvironment(admin.toString()),
  }).catch(() => undefined);
  if (fixtureUserId)
    await source.user
      .delete({ where: { id: fixtureUserId } })
      .catch(() => undefined);
  if (sourceStorage && fixtureArtifactKey)
    await sourceStorage.delete(fixtureArtifactKey).catch(() => undefined);
  await source.$disconnect();
  await redis.stop();
  await fs.rm(workspace, { recursive: true, force: true });
}
