import {
  Prisma,
  UsageMeasurement,
  UsageType,
  UsageUnit,
  type RunStatus,
} from '@prisma/client';

import { getUtcCalendarMonthPeriod } from './period';
import {
  createRunTerminalNotification,
  createUsageThresholdNotifications,
} from '@/lib/notifications/events';
import { createRunWebhookEvent } from '@/lib/webhooks/events';

type UsageTransaction = Prisma.TransactionClient;

function supportsNotifications(transaction: UsageTransaction) {
  return Boolean(
    (transaction as Partial<UsageTransaction>).notification &&
    (transaction as Partial<UsageTransaction>).notificationDelivery
  );
}

export interface UsageEntry {
  userId: string;
  runId: string;
  attempt?: number | null;
  type: UsageType;
  quantity: bigint;
  unit: UsageUnit;
  measurement: UsageMeasurement;
  idempotencyKey: string;
  recordedAt?: Date;
  metadata?: Prisma.InputJsonValue;
}

export async function recordUsage(
  transaction: UsageTransaction,
  entry: UsageEntry
): Promise<void> {
  if (entry.quantity < 0n)
    throw new Error('Usage quantity cannot be negative.');
  const recordedAt = entry.recordedAt ?? new Date();
  const period = getUtcCalendarMonthPeriod(recordedAt);
  await transaction.usageRecord.createMany({
    data: [
      {
        userId: entry.userId,
        runId: entry.runId,
        attempt: entry.attempt,
        type: entry.type,
        quantity: entry.quantity,
        unit: entry.unit,
        measurement: entry.measurement,
        idempotencyKey: entry.idempotencyKey,
        recordedAt,
        periodStart: period.start,
        periodEnd: period.end,
        metadata: entry.metadata,
      },
    ],
    skipDuplicates: true,
  });
  if (
    supportsNotifications(transaction) &&
    (entry.type === UsageType.RUN_ADMITTED ||
      entry.type === UsageType.ARTIFACT_BYTE)
  ) {
    await createUsageThresholdNotifications(transaction, {
      userId: entry.userId,
      metric: entry.type === UsageType.RUN_ADMITTED ? 'runs' : 'storage',
      periodStart: period.start,
      periodEnd: period.end,
    });
  }
  if (
    entry.type === UsageType.RUN_ADMITTED &&
    Boolean((transaction as Partial<UsageTransaction>).webhookEvent)
  ) {
    await createRunWebhookEvent(transaction, {
      userId: entry.userId,
      runId: entry.runId,
      status: 'QUEUED',
      recordedAt,
    });
  }
}

export async function recordArtifactUsage(
  transaction: UsageTransaction,
  input: {
    userId: string;
    runId: string;
    artifactId: string;
    bytes: number;
    recordedAt?: Date;
  }
) {
  await recordUsage(transaction, {
    userId: input.userId,
    runId: input.runId,
    type: UsageType.ARTIFACT_BYTE,
    quantity: BigInt(input.bytes),
    unit: UsageUnit.BYTE,
    measurement: UsageMeasurement.EXACT,
    idempotencyKey: `run:${input.runId}:artifact:${input.artifactId}:bytes`,
    recordedAt: input.recordedAt,
  });
}

export async function recordAttemptDuration(
  transaction: UsageTransaction,
  input: {
    userId: string;
    runId: string;
    attempt: number;
    durationMs: number;
    recordedAt?: Date;
  }
) {
  await recordUsage(transaction, {
    userId: input.userId,
    runId: input.runId,
    attempt: input.attempt,
    type: UsageType.EXECUTION_MILLISECOND,
    quantity: BigInt(Math.max(0, Math.trunc(input.durationMs))),
    unit: UsageUnit.MILLISECOND,
    measurement: UsageMeasurement.DERIVED,
    idempotencyKey: `run:${input.runId}:attempt:${input.attempt}:execution-ms`,
    recordedAt: input.recordedAt,
  });
}

const TERMINAL_USAGE_TYPE: Partial<Record<RunStatus, UsageType>> = {
  SUCCESS: UsageType.RUN_SUCCEEDED,
  FAILED: UsageType.RUN_FAILED,
  TIMED_OUT: UsageType.RUN_TIMED_OUT,
  CANCELED: UsageType.RUN_CANCELED,
};

export async function recordTerminalUsage(
  transaction: UsageTransaction,
  input: {
    userId: string;
    runId: string;
    status: RunStatus;
    attempt: number;
    durationMs: number;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null;
    recordedAt?: Date;
  }
) {
  const type = TERMINAL_USAGE_TYPE[input.status];
  if (!type) throw new Error('Terminal usage requires a terminal Run status.');
  await recordUsage(transaction, {
    userId: input.userId,
    runId: input.runId,
    attempt: input.attempt,
    type,
    quantity: 1n,
    unit: UsageUnit.COUNT,
    measurement: UsageMeasurement.EXACT,
    idempotencyKey: `run:${input.runId}:terminal`,
    recordedAt: input.recordedAt,
    metadata: { status: input.status },
  });
  await recordAttemptDuration(transaction, input);
  if (supportsNotifications(transaction)) {
    await createRunTerminalNotification(transaction, {
      userId: input.userId,
      runId: input.runId,
      status: input.status,
      recordedAt: input.recordedAt ?? new Date(),
    });
  }
  if ((transaction as Partial<UsageTransaction>).webhookEvent) {
    await createRunWebhookEvent(transaction, {
      userId: input.userId,
      runId: input.runId,
      status: input.status,
      recordedAt: input.recordedAt,
    });
  }
  if (input.tokenUsage) {
    for (const metric of [
      {
        type: UsageType.LLM_INPUT_TOKEN,
        quantity: input.tokenUsage.inputTokens,
        suffix: 'llm-input-tokens',
      },
      {
        type: UsageType.LLM_OUTPUT_TOKEN,
        quantity: input.tokenUsage.outputTokens,
        suffix: 'llm-output-tokens',
      },
      {
        type: UsageType.LLM_TOTAL_TOKEN,
        quantity: input.tokenUsage.totalTokens,
        suffix: 'llm-total-tokens',
      },
    ]) {
      await recordUsage(transaction, {
        userId: input.userId,
        runId: input.runId,
        attempt: input.attempt,
        type: metric.type,
        quantity: BigInt(metric.quantity),
        unit: UsageUnit.COUNT,
        measurement: UsageMeasurement.PROVIDER_REPORTED,
        idempotencyKey: `run:${input.runId}:attempt:${input.attempt}:${metric.suffix}`,
        recordedAt: input.recordedAt,
      });
    }
  }
}
