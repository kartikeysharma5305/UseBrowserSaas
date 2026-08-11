import {
  UsageMeasurement,
  UsageType,
  UsageUnit,
  type RunStatus,
} from '@prisma/client';

import { prisma } from '../src/lib/db/prisma';
import {
  recordArtifactUsage,
  recordAttemptDuration,
  recordUsage,
} from '../src/lib/usage/ledger';
import { getUtcCalendarMonthPeriod } from '../src/lib/usage/period';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const batchRaw = args
  .find((value) => value.startsWith('--batch-size='))
  ?.slice('--batch-size='.length);
const batchSize = batchRaw ? Number(batchRaw) : 250;
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('batch-size must be an integer from 1 to 1000.');
}
const runs = await prisma.run.findMany({
  include: {
    agent: { select: { userId: true } },
    artifacts: true,
    usageRecords: true,
  },
  orderBy: { createdAt: 'asc' },
  take: batchSize,
});
const detachedUsageRecords = await prisma.usageRecord.count({
  where: { runId: null },
});
const terminalTypes: Partial<Record<RunStatus, UsageType>> = {
  SUCCESS: UsageType.RUN_SUCCEEDED,
  FAILED: UsageType.RUN_FAILED,
  TIMED_OUT: UsageType.RUN_TIMED_OUT,
  CANCELED: UsageType.RUN_CANCELED,
};
const result = {
  dryRun: !apply,
  inspected: runs.length,
  missingAdmissions: 0,
  missingTerminals: 0,
  missingAttemptDurations: 0,
  missingArtifactBytes: 0,
  unmeteredRetainedArtifactBytes: '0',
  duplicateIdempotencyKeys: 0,
  periodMismatches: 0,
  attemptMismatches: 0,
  detachedUsageRecords,
  negativeQuantities: 0,
  repaired: 0,
  historicalTokenMetricsCreated: 0,
};
let unmeteredRetainedArtifactBytes = 0n;

for (const run of runs) {
  const keys = new Set(run.usageRecords.map((record) => record.idempotencyKey));
  result.periodMismatches += run.usageRecords.filter(
    (record) =>
      record.periodStart.getTime() !==
        getUtcCalendarMonthPeriod(record.recordedAt).start.getTime() ||
      record.periodEnd.getTime() !==
        getUtcCalendarMonthPeriod(record.recordedAt).end.getTime()
  ).length;
  result.negativeQuantities += run.usageRecords.filter(
    (record) => record.quantity < 0n
  ).length;
  result.attemptMismatches += run.usageRecords.filter(
    (record) =>
      record.attempt !== null &&
      (record.attempt < 1 || record.attempt > run.attempt)
  ).length;
  if (!keys.has(`run:${run.id}:admitted`)) result.missingAdmissions += 1;
  const terminalType = terminalTypes[run.status];
  if (terminalType && !keys.has(`run:${run.id}:terminal`)) {
    result.missingTerminals += 1;
  }
  if (
    terminalType &&
    run.duration !== null &&
    run.attempt > 0 &&
    !keys.has(`run:${run.id}:attempt:${run.attempt}:execution-ms`)
  ) {
    result.missingAttemptDurations += 1;
  }
  const missingArtifacts = run.artifacts.filter(
    (artifact) => !keys.has(`run:${run.id}:artifact:${artifact.id}:bytes`)
  );
  result.missingArtifactBytes += missingArtifacts.length;
  unmeteredRetainedArtifactBytes += missingArtifacts.reduce(
    (total, artifact) => total + BigInt(artifact.size),
    0n
  );
  const periodMismatches = run.usageRecords.filter((record) => {
    const expected = getUtcCalendarMonthPeriod(record.recordedAt);
    return (
      record.periodStart.getTime() !== expected.start.getTime() ||
      record.periodEnd.getTime() !== expected.end.getTime()
    );
  });
  const needsRepair =
    !keys.has(`run:${run.id}:admitted`) ||
    (terminalType !== undefined && !keys.has(`run:${run.id}:terminal`)) ||
    (terminalType !== undefined &&
      run.duration !== null &&
      run.attempt > 0 &&
      !keys.has(`run:${run.id}:attempt:${run.attempt}:execution-ms`)) ||
    missingArtifacts.length > 0;
  if (!apply) continue;

  await prisma.$transaction(async (transaction) => {
    for (const record of periodMismatches) {
      const expected = getUtcCalendarMonthPeriod(record.recordedAt);
      await transaction.usageRecord.update({
        where: { id: record.id },
        data: { periodStart: expected.start, periodEnd: expected.end },
      });
    }
    await recordUsage(transaction, {
      userId: run.agent.userId,
      runId: run.id,
      type: UsageType.RUN_ADMITTED,
      quantity: 1n,
      unit: UsageUnit.COUNT,
      measurement: UsageMeasurement.DERIVED,
      idempotencyKey: `run:${run.id}:admitted`,
      recordedAt: run.createdAt,
      metadata: { historicalBackfill: true },
    });
    if (terminalType && run.completedAt) {
      await recordUsage(transaction, {
        userId: run.agent.userId,
        runId: run.id,
        attempt: run.attempt || null,
        type: terminalType,
        quantity: 1n,
        unit: UsageUnit.COUNT,
        measurement: UsageMeasurement.DERIVED,
        idempotencyKey: `run:${run.id}:terminal`,
        recordedAt: run.completedAt,
        metadata: { status: run.status, historicalBackfill: true },
      });
    }
    if (run.duration !== null && run.attempt > 0 && terminalType) {
      await recordAttemptDuration(transaction, {
        userId: run.agent.userId,
        runId: run.id,
        attempt: run.attempt,
        durationMs: run.duration,
        recordedAt: run.completedAt ?? run.startedAt,
      });
    }
    for (const artifact of run.artifacts) {
      await recordArtifactUsage(transaction, {
        userId: run.agent.userId,
        runId: run.id,
        artifactId: artifact.id,
        bytes: artifact.size,
        recordedAt: artifact.createdAt,
      });
    }
  });
  if (needsRepair || periodMismatches.length > 0) result.repaired += 1;
}

result.unmeteredRetainedArtifactBytes =
  unmeteredRetainedArtifactBytes.toString();
console.log(JSON.stringify(result));
await prisma.$disconnect();
