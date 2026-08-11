import { Prisma, UsageType, type PlanCode } from '@prisma/client';

import type { NormalizedAgentConfiguration } from '@/lib/execution/agent-configuration';
import { ExecutionServiceError } from '@/lib/execution/errors';
import { getPlan } from '@/lib/plans/catalogue';

import { createRunCostBudget, type RunCostBudgetSnapshot } from './cost-policy';
import { getUtcCalendarMonthPeriod } from './period';

type UsageTransaction = Prisma.TransactionClient;

export interface QuotaSnapshot {
  planCode: PlanCode;
  retainedArtifactBytes: bigint;
  remainingArtifactBytes: bigint;
  costBudget: RunCostBudgetSnapshot;
}

export async function enforceAdmissionQuota(
  transaction: UsageTransaction,
  input: {
    userId: string;
    configuration: NormalizedAgentConfiguration;
    now: Date;
  }
): Promise<QuotaSnapshot> {
  const user = await transaction.user.findUnique({
    where: { id: input.userId },
    select: { planCode: true },
  });
  if (!user) {
    throw new ExecutionServiceError('PLAN_CONFIGURATION_INVALID', {
      stage: 'queue_reserve',
    });
  }
  const plan = getPlan(user.planCode);
  if (input.configuration.timeoutMs > plan.limits.maxRunDurationMs) {
    throw new ExecutionServiceError('MAX_RUN_DURATION_EXCEEDED', {
      stage: 'configuration',
    });
  }
  if (input.configuration.maxSteps > plan.limits.maxStepsPerRun) {
    throw new ExecutionServiceError('MAX_STEPS_EXCEEDED', {
      stage: 'configuration',
    });
  }

  const period = getUtcCalendarMonthPeriod(input.now);
  const admitted = await transaction.usageRecord.aggregate({
    where: {
      userId: input.userId,
      type: UsageType.RUN_ADMITTED,
      periodStart: period.start,
    },
    _sum: { quantity: true },
  });
  if ((admitted._sum.quantity ?? 0n) >= BigInt(plan.limits.runsPerMonth)) {
    throw new ExecutionServiceError('MONTHLY_RUN_LIMIT_REACHED', {
      stage: 'queue_reserve',
    });
  }

  const execution = await transaction.usageRecord.aggregate({
    where: {
      userId: input.userId,
      type: UsageType.EXECUTION_MILLISECOND,
      periodStart: period.start,
    },
    _sum: { quantity: true },
  });
  const executionMs = execution._sum.quantity ?? 0n;
  if (
    executionMs + BigInt(input.configuration.timeoutMs) >
    BigInt(plan.limits.executionMsPerMonth)
  ) {
    throw new ExecutionServiceError('MONTHLY_EXECUTION_LIMIT_REACHED', {
      stage: 'queue_reserve',
    });
  }

  const active = await transaction.run.count({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      agent: { userId: input.userId },
    },
  });
  if (active >= plan.limits.activeRuns) {
    throw new ExecutionServiceError('USER_RUN_LIMIT_REACHED', {
      stage: 'queue_reserve',
    });
  }

  const storage = await transaction.runArtifact.aggregate({
    where: { run: { agent: { userId: input.userId } } },
    _sum: { size: true },
  });
  const retainedArtifactBytes = BigInt(storage._sum.size ?? 0);
  if (retainedArtifactBytes >= plan.limits.artifactStorageBytes) {
    throw new ExecutionServiceError('STORAGE_LIMIT_REACHED', {
      stage: 'queue_reserve',
    });
  }
  return {
    planCode: user.planCode,
    retainedArtifactBytes,
    remainingArtifactBytes:
      plan.limits.artifactStorageBytes - retainedArtifactBytes,
    costBudget: createRunCostBudget(plan, input.configuration, input.now),
  };
}

export async function getWorkerArtifactBudget(
  transaction: UsageTransaction,
  input: {
    userId: string;
    costBudget: RunCostBudgetSnapshot;
  }
): Promise<QuotaSnapshot> {
  const storage = await transaction.runArtifact.aggregate({
    where: { run: { agent: { userId: input.userId } } },
    _sum: { size: true },
  });
  const retainedArtifactBytes = BigInt(storage._sum.size ?? 0);
  const admittedStorageLimit = BigInt(input.costBudget.userStorageLimitBytes);
  return {
    planCode: input.costBudget.planCode,
    retainedArtifactBytes,
    remainingArtifactBytes:
      retainedArtifactBytes < admittedStorageLimit
        ? admittedStorageLimit - retainedArtifactBytes
        : 0n,
    costBudget: input.costBudget,
  };
}
