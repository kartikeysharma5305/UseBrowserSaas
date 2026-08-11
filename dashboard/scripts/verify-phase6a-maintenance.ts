import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '../src/lib/db/prisma';
import { cleanupExpiredArtifacts } from '../src/lib/browser/artifact-retention';
import { LocalArtifactStorage } from '../src/lib/browser/artifact-storage';
import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';
import { DEFAULT_GROQ_MODEL } from '../src/lib/execution/groq-models';
import { ExecutionServiceError } from '../src/lib/execution/errors';
import { closeBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';

if (
  process.platform !== 'linux' ||
  process.env.PHASE6A_RUNTIME_VERIFICATION !== '1'
) {
  throw new Error('Phase 6A maintenance verification requires isolated Linux.');
}

const root = path.resolve(import.meta.dirname, '..');
const nonce = randomUUID();
const localRoot = path.join(root, '.runtime', 'phase6a', nonce);
const redisPort = 6385;
const queueName = `phase6a-maintenance-${nonce}`;
process.env.ARTIFACT_STORAGE_ROOT = localRoot;
process.env.EXECUTION_QUEUE_NAME = queueName;
process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
process.env.EXECUTION_QUEUE_MAX_WAITING = '20';
await mkdir(localRoot, { recursive: true });

const before = {
  users: await prisma.user.count(),
  agents: await prisma.agent.count(),
  runs: await prisma.run.count(),
  artifacts: await prisma.runArtifact.count(),
  usage: await prisma.usageRecord.count(),
};
const userIds: string[] = [];
let redis: ChildProcess | undefined;

function runMaintenance(script: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/tsx/dist/cli.mjs'), script, ...args],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit ${result.status}.`);
  }
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `phase6a-${label}-${nonce}@example.invalid`,
      name: 'Phase 6A runtime fixture',
    },
  });
  userIds.push(user.id);
  return user;
}

async function createAgent(userId: string, label: string) {
  return prisma.agent.create({
    data: {
      userId,
      name: `Phase 6A ${label}`,
      goal: 'Read a safe disposable page.',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      scheduleType: 'MANUAL',
      configuration: {
        model: DEFAULT_GROQ_MODEL.id,
        maxSteps: 5,
        timeoutMs: 60_000,
        browserSettings: {
          headless: true,
          viewportWidth: 1024,
          viewportHeight: 720,
        },
      },
    },
  });
}

async function waitForRedis() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const socket = await import('node:net').then(
      ({ createConnection }) =>
        new Promise<boolean>((resolve) => {
          const connection = createConnection(
            { host: '127.0.0.1', port: redisPort },
            () => {
              connection.destroy();
              resolve(true);
            }
          );
          connection.once('error', () => resolve(false));
        })
    );
    if (socket) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Redis did not become ready.');
}

const report: Record<string, unknown> = {};
try {
  const user = await createUser('maintenance');
  const agent = await createAgent(user.id, 'migration');
  const run = await prisma.run.create({
    data: {
      agentId: agent.id,
      status: 'SUCCESS',
      completedAt: new Date(),
      duration: 100,
      attempt: 1,
    },
  });
  const local = new LocalArtifactStorage();
  const saved = await local.save({
    runId: run.id,
    fileName: 'migration.png',
    mimeType: 'image/png',
    data: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('phase6a'),
    ]),
  });
  const artifact = await prisma.runArtifact.create({
    data: {
      runId: run.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      storageKey: saved.storageKey,
      checksum: saved.checksum,
      fileName: saved.fileName,
      mimeType: saved.mimeType,
      size: saved.size,
    },
  });

  process.env.ARTIFACT_MIGRATION_ENVIRONMENT = 'phase6a-runtime';
  const migrationDryRun = runMaintenance('scripts/migrate-artifacts.ts', [
    `--artifact-id=${artifact.id}`,
  ]);
  const migrationApply = runMaintenance('scripts/migrate-artifacts.ts', [
    '--apply',
    '--environment=phase6a-runtime',
    `--artifact-id=${artifact.id}`,
  ]);
  const migrated = await prisma.runArtifact.findUniqueOrThrow({
    where: { id: artifact.id },
  });
  const remote = createArtifactStorage('S3');
  const remoteStat = await remote.stat(migrated.storageKey);
  let localRemoved = false;
  try {
    await local.stat(saved.storageKey);
  } catch {
    localRemoved = true;
  }
  if (
    migrationDryRun.migrated !== 0 ||
    migrationApply.migrated !== 1 ||
    migrated.storageProvider !== 'S3' ||
    remoteStat.size !== artifact.size ||
    !localRemoved
  ) {
    throw new Error('Artifact migration assertions failed.');
  }
  report.migration = {
    dryRun: migrationDryRun,
    apply: migrationApply,
    provider: migrated.storageProvider,
    remoteBytes: remoteStat.size,
    localRemoved,
  };

  await prisma.runArtifact.update({
    where: { id: artifact.id },
    data: { createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
  });
  const retentionDryRun = await cleanupExpiredArtifacts({ dryRun: true });
  const retainedAfterDryRun = await prisma.runArtifact.count({
    where: { id: artifact.id },
  });
  const retentionApply = await cleanupExpiredArtifacts({ dryRun: false });
  const retainedAfterApply = await prisma.runArtifact.count({
    where: { id: artifact.id },
  });
  if (
    retentionDryRun.eligible !== 1 ||
    retainedAfterDryRun !== 1 ||
    retentionApply.deleted !== 1 ||
    retainedAfterApply !== 0
  ) {
    throw new Error('Plan-aware retention assertions failed.');
  }
  report.retention = {
    dryRun: retentionDryRun,
    apply: retentionApply,
    retainedAfterDryRun,
    retainedAfterApply,
  };

  const reconcileDryRun = runMaintenance('scripts/reconcile-usage.ts', []);
  const reconcileApply = runMaintenance('scripts/reconcile-usage.ts', [
    '--apply',
  ]);
  const usageAfterApply = await prisma.usageRecord.count({
    where: { runId: run.id },
  });
  const reconcileAgain = runMaintenance('scripts/reconcile-usage.ts', [
    '--apply',
  ]);
  if (
    Number(reconcileDryRun.missingAdmissions) < 1 ||
    usageAfterApply < 3 ||
    reconcileAgain.missingAdmissions !== 0 ||
    reconcileAgain.missingTerminals !== 0
  ) {
    throw new Error('Usage reconciliation assertions failed.');
  }
  report.reconciliation = {
    dryRun: reconcileDryRun,
    apply: reconcileApply,
    repeatApply: reconcileAgain,
    usageAfterApply,
  };

  const planDryRun = runMaintenance('scripts/assign-plan.ts', [
    `--email=${user.email}`,
    '--plan=PRO',
  ]);
  const planApply = runMaintenance('scripts/assign-plan.ts', [
    `--email=${user.email}`,
    '--plan=PRO',
    '--apply',
    '--reason=Phase 6A isolated verification',
  ]);
  const assigned = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { planCode: true, planAssignedAt: true },
  });
  if (
    planDryRun.dryRun !== true ||
    planApply.dryRun !== false ||
    assigned.planCode !== 'PRO' ||
    assigned.planAssignedAt === null
  ) {
    throw new Error('Plan assignment assertions failed.');
  }
  report.planAssignment = {
    dryRun: planDryRun.dryRun,
    applied: planApply.dryRun === false,
    plan: assigned.planCode,
    timestampRecorded: assigned.planAssignedAt !== null,
  };

  redis = spawn('redis-server', [
    '--bind',
    '127.0.0.1',
    '--port',
    String(redisPort),
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
  await waitForRedis();
  const quotaUser = await createUser('quota');
  const quotaAgentOne = await createAgent(quotaUser.id, 'quota-one');
  const quotaAgentTwo = await createAgent(quotaUser.id, 'quota-two');
  await prisma.usageRecord.create({
    data: {
      userId: quotaUser.id,
      type: 'RUN_ADMITTED',
      quantity: 24n,
      unit: 'COUNT',
      measurement: 'EXACT',
      idempotencyKey: `fixture:${nonce}:24-admitted-runs`,
      periodStart: new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
      ),
      periodEnd: new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)
      ),
    },
  });
  const producer = new PrismaRunProducer();
  const race = await Promise.allSettled([
    producer.enqueue({ agentId: quotaAgentOne.id, userId: quotaUser.id }),
    producer.enqueue({ agentId: quotaAgentTwo.id, userId: quotaUser.id }),
  ]);
  const fulfilled = race.filter(
    (
      result
    ): result is PromiseFulfilledResult<
      Awaited<ReturnType<typeof producer.enqueue>>
    > => result.status === 'fulfilled'
  );
  const rejected = race.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  const rejectionCode =
    rejected[0]?.reason instanceof ExecutionServiceError
      ? rejected[0].reason.code
      : null;
  const otherUser = await createUser('isolated');
  const otherAgent = await createAgent(otherUser.id, 'isolated');
  const otherRun = await producer.enqueue({
    agentId: otherAgent.id,
    userId: otherUser.id,
  });
  await prisma.user.update({
    where: { id: quotaUser.id },
    data: { planCode: 'PRO', planAssignedAt: new Date() },
  });
  const upgradedAgent = await createAgent(quotaUser.id, 'upgraded');
  const upgradedRun = await producer.enqueue({
    agentId: upgradedAgent.id,
    userId: quotaUser.id,
  });
  if (
    fulfilled.length !== 1 ||
    rejected.length !== 1 ||
    rejectionCode !== 'MONTHLY_RUN_LIMIT_REACHED' ||
    otherRun.status !== 'QUEUED' ||
    upgradedRun.status !== 'QUEUED'
  ) {
    throw new Error('Quota race or isolation assertions failed.');
  }
  report.quota = {
    concurrentAccepted: fulfilled.length,
    concurrentRejected: rejected.length,
    rejectionCode,
    otherUserUnaffected: otherRun.status === 'QUEUED',
    upgradePermittedRun: upgradedRun.status === 'QUEUED',
  };
} finally {
  await closeBrowserRunQueue().catch(() => undefined);
  if (redis && redis.exitCode === null) {
    redis.kill('SIGTERM');
    await new Promise((resolve) => redis?.once('exit', resolve));
  }
  for (const userId of userIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await rm(localRoot, { recursive: true, force: true });
}

const after = {
  users: await prisma.user.count(),
  agents: await prisma.agent.count(),
  runs: await prisma.run.count(),
  artifacts: await prisma.runArtifact.count(),
  usage: await prisma.usageRecord.count(),
};
await prisma.$disconnect();
console.info(
  JSON.stringify({
    ...report,
    cleanup: {
      before,
      after,
      countsRestored: JSON.stringify(before) === JSON.stringify(after),
    },
  })
);
