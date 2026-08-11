import { randomUUID } from 'node:crypto';

import { RedisMemoryServer } from 'redis-memory-server';

import { prisma } from '../src/lib/db/prisma';
import { PrismaRunPersistence } from '../src/lib/browser/run-persistence';
import {
  buildOwnedCsvDownload,
  buildOwnedJsonDownload,
} from '../src/lib/structured-results/downloads';

const nonce = randomUUID().slice(0, 8);
const redis = await RedisMemoryServer.create();
process.env.REDIS_URL = `redis://${await redis.getHost()}:${await redis.getPort()}`;
process.env.EXECUTION_QUEUE_NAME = `phase12-${nonce}`;

const { PrismaRunProducer } = await import('../src/lib/queue/run-producer');
const { getBrowserRunQueue, closeBrowserRunQueue } =
  await import('../src/lib/queue/browser-run-queue');
const producer = new PrismaRunProducer();
const persistence = new PrismaRunPersistence();
const ownerId = `phase12-owner-${nonce}`;
const controlId = `phase12-control-${nonce}`;
const schemaV1 = {
  enabled: true,
  version: 1,
  mode: 'PARTIAL',
  fields: [
    {
      key: 'productName',
      label: 'Product name',
      type: 'string',
      required: true,
    },
    { key: 'price', label: 'Price', type: 'number', required: true },
    { key: 'available', label: 'Available', type: 'boolean', required: true },
    { key: 'note', label: 'Note', type: 'string', required: false },
  ],
} as const;
const evidence = {
  manualAdmissionSnapshot: false,
  scheduledAdmissionSnapshot: false,
  immutableQueuedSnapshot: false,
  validPersistence: false,
  invalidJson: false,
  partialPersistence: false,
  jsonDownload: false,
  csvFormulaProtection: false,
  crossUserDenied: false,
  accountDeletionBlocked: false,
  cleanup: false,
};

async function createAgent(id: string, outputSchema: unknown) {
  return prisma.agent.create({
    data: {
      id,
      userId: ownerId,
      name: 'Disposable structured agent',
      goal: 'Return product facts',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      scheduleType: 'MANUAL',
      scheduleConfig: {},
      configuration: {
        model: 'groq_llama-3.3-70b-versatile',
        maxSteps: 5,
        timeoutMs: 60000,
        browserSettings: {
          headless: true,
          viewportWidth: 1280,
          viewportHeight: 720,
        },
      },
      outputSchema: outputSchema as object,
    },
  });
}

async function finish(runId: string, rawResult: string) {
  const startedAt = new Date();
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt },
  });
  await persistence.finalizeRun({
    runId,
    startedAt,
    status: 'SUCCESS',
    result: {
      durationMs: 1,
      summary: 'Disposable fixture result.',
      rawResult,
      visitedUrls: [],
    },
    events: [],
    artifacts: [],
  });
  return prisma.run.findUniqueOrThrow({ where: { id: runId } });
}

try {
  await prisma.user.createMany({
    data: [
      {
        id: ownerId,
        email: `${ownerId}@example.invalid`,
        name: 'Phase 12 owner',
        planCode: 'INTERNAL',
        planSource: 'INTERNAL',
      },
      {
        id: controlId,
        email: `${controlId}@example.invalid`,
        name: 'Phase 12 control',
        planCode: 'INTERNAL',
        planSource: 'INTERNAL',
      },
    ],
  });

  const agent = await createAgent(`phase12-agent-${nonce}`, schemaV1);
  const manual = await producer.enqueue({ agentId: agent.id, userId: ownerId });
  const queued = await prisma.run.findUniqueOrThrow({
    where: { id: manual.runId },
  });
  evidence.manualAdmissionSnapshot =
    queued.structuredStatus === 'PENDING' && queued.outputSchemaVersion === 1;
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      outputSchema: {
        ...schemaV1,
        fields: [
          { key: 'changed', label: 'Changed', type: 'string', required: true },
        ],
      },
    },
  });
  const unchanged = await prisma.run.findUniqueOrThrow({
    where: { id: manual.runId },
  });
  evidence.immutableQueuedSnapshot =
    JSON.stringify(unchanged.outputSchemaSnapshot).includes('productName') &&
    !JSON.stringify(unchanged.outputSchemaSnapshot).includes('changed');
  const valid = await finish(
    manual.runId,
    '{"productName":"Desk","price":25,"available":true,"note":"=SUM(A1:A2)"}'
  );
  evidence.validPersistence =
    valid.status === 'SUCCESS' &&
    valid.structuredStatus === 'VALID' &&
    Boolean(valid.structuredRawResult) &&
    Boolean(valid.structuredCandidate) &&
    Boolean(valid.structuredResult);
  const json = await buildOwnedJsonDownload(ownerId, manual.runId);
  const csv = await buildOwnedCsvDownload(ownerId, manual.runId);
  evidence.jsonDownload = Boolean(json?.body.includes('productName'));
  evidence.csvFormulaProtection = Boolean(csv?.body.includes("'=SUM(A1:A2)"));
  evidence.crossUserDenied =
    (await buildOwnedJsonDownload(controlId, manual.runId)) === null;

  await prisma.agent.update({
    where: { id: agent.id },
    data: { outputSchema: schemaV1 as object },
  });
  const schedule = await prisma.schedule.create({
    data: {
      id: `phase12-schedule-${nonce}`,
      userId: ownerId,
      agentId: agent.id,
      kind: 'ONCE',
      timezone: 'UTC',
      oneTimeAt: new Date(Date.now() + 60_000),
      state: 'ENABLED',
      nextRunAt: new Date(Date.now() + 60_000),
      variableValues: {},
    },
  });
  const scheduledFor = new Date(Date.now() + 60_000);
  const occurrence = await prisma.scheduledOccurrence.create({
    data: { scheduleId: schedule.id, scheduledFor, status: 'DISCOVERED' },
  });
  const scheduled = await producer.enqueue({
    agentId: agent.id,
    userId: ownerId,
    scheduled: {
      scheduleId: schedule.id,
      occurrenceId: occurrence.id,
      scheduledFor,
    },
  });
  const scheduledRun = await prisma.run.findUniqueOrThrow({
    where: { id: scheduled.runId },
  });
  evidence.scheduledAdmissionSnapshot =
    scheduledRun.structuredStatus === 'PENDING' &&
    JSON.stringify(scheduledRun.outputSchemaSnapshot).includes('productName');
  await finish(scheduled.runId, 'not json');
  const malformed = await prisma.run.findUniqueOrThrow({
    where: { id: scheduled.runId },
  });
  evidence.invalidJson =
    malformed.status === 'SUCCESS' &&
    malformed.structuredStatus === 'PARSE_FAILED';

  const partialAgent = await createAgent(`phase12-partial-${nonce}`, schemaV1);
  const partialAdmission = await producer.enqueue({
    agentId: partialAgent.id,
    userId: ownerId,
  });
  const partial = await finish(
    partialAdmission.runId,
    '{"productName":"Desk","price":"wrong","available":true}'
  );
  evidence.partialPersistence =
    partial.structuredStatus === 'PARTIAL' &&
    JSON.stringify(partial.structuredResult).includes('productName') &&
    !JSON.stringify(partial.structuredResult).includes('wrong');

  await prisma.accountDeletion.create({
    data: { userId: ownerId, status: 'PENDING', stage: 'REQUESTED' },
  });
  const blockedAgent = await createAgent(`phase12-blocked-${nonce}`, schemaV1);
  try {
    await producer.enqueue({ agentId: blockedAgent.id, userId: ownerId });
  } catch (error) {
    evidence.accountDeletionBlocked =
      (error as { code?: string }).code === 'ACCOUNT_DELETION_IN_PROGRESS';
  }

  const failed = Object.entries(evidence)
    .filter(([key, value]) => key !== 'cleanup' && !value)
    .map(([key]) => key);
  if (failed.length)
    throw new Error(`Phase 12 runtime assertions failed: ${failed.join(', ')}`);
} finally {
  const queue = getBrowserRunQueue();
  await queue.drain(true).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, controlId] } } });
  evidence.cleanup =
    (await prisma.user.count({
      where: { id: { in: [ownerId, controlId] } },
    })) === 0;
  await closeBrowserRunQueue();
  await redis.stop();
  await prisma.$disconnect();
}

if (Object.values(evidence).some((value) => !value))
  throw new Error('Phase 12 runtime verification did not close cleanly.');
console.info(JSON.stringify({ phase: 12, status: 'passed', evidence }));
