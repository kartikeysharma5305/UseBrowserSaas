import { UsageType } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getPlan, toClientPlan } from '@/lib/plans/catalogue';

import {
  getPreviousUtcCalendarMonthPeriod,
  getUtcCalendarMonthPeriod,
  type UsagePeriod,
} from './period';

async function aggregatePeriod(userId: string, period: UsagePeriod) {
  const groups = await prisma.usageRecord.groupBy({
    by: ['type'],
    where: {
      userId,
      periodStart: period.start,
    },
    _sum: { quantity: true },
    _count: true,
  });
  const quantities = new Map(
    groups.map((group) => [group.type, group._sum.quantity ?? 0n])
  );
  const runTotal = quantities.get(UsageType.RUN_ADMITTED) ?? 0n;
  const executionMs = quantities.get(UsageType.EXECUTION_MILLISECOND) ?? 0n;
  const steps = quantities.get(UsageType.BROWSER_STEP) ?? 0n;
  const attempts = quantities.get(UsageType.ATTEMPT_STARTED) ?? 0n;
  const artifactBytes = quantities.get(UsageType.ARTIFACT_BYTE) ?? 0n;
  const artifactGroup = groups.find(
    (group) => group.type === UsageType.ARTIFACT_BYTE
  );
  const inputTokens = quantities.get(UsageType.LLM_INPUT_TOKEN);
  const outputTokens = quantities.get(UsageType.LLM_OUTPUT_TOKEN);
  const totalTokens = quantities.get(UsageType.LLM_TOTAL_TOKEN);

  return {
    runs: runTotal.toString(),
    attempts: attempts.toString(),
    executionMs: executionMs.toString(),
    steps: steps.toString(),
    artifactBytes: artifactBytes.toString(),
    artifactCount: artifactGroup?._count ?? 0,
    inputTokens: inputTokens?.toString() ?? null,
    outputTokens: outputTokens?.toString() ?? null,
    totalTokens: totalTokens?.toString() ?? null,
    terminal: {
      success: (quantities.get(UsageType.RUN_SUCCEEDED) ?? 0n).toString(),
      failed: (quantities.get(UsageType.RUN_FAILED) ?? 0n).toString(),
      timedOut: (quantities.get(UsageType.RUN_TIMED_OUT) ?? 0n).toString(),
      canceled: (quantities.get(UsageType.RUN_CANCELED) ?? 0n).toString(),
    },
  };
}

export async function getCurrentUsage(userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planCode: true },
  });
  if (!user) throw new Error('User not found.');
  const period = getUtcCalendarMonthPeriod(now);
  const plan = getPlan(user.planCode);
  const usage = await aggregatePeriod(userId, period);
  const storage = await prisma.runArtifact.aggregate({
    where: { run: { agent: { userId } } },
    _sum: { size: true },
    _count: true,
  });
  usage.artifactBytes = BigInt(storage._sum.size ?? 0).toString();
  usage.artifactCount = storage._count;
  const runs = BigInt(usage.runs);
  const storageBytes = BigInt(usage.artifactBytes);
  return {
    plan: toClientPlan(plan),
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    usage,
    remaining: {
      runs: (BigInt(plan.limits.runsPerMonth) > runs
        ? BigInt(plan.limits.runsPerMonth) - runs
        : 0n
      ).toString(),
      executionMs: (BigInt(plan.limits.executionMsPerMonth) >
      BigInt(usage.executionMs)
        ? BigInt(plan.limits.executionMsPerMonth) - BigInt(usage.executionMs)
        : 0n
      ).toString(),
      artifactStorageBytes: (plan.limits.artifactStorageBytes > storageBytes
        ? plan.limits.artifactStorageBytes - storageBytes
        : 0n
      ).toString(),
    },
  };
}

export async function getUsageHistory(
  userId: string,
  monthCount = 6,
  now = new Date()
) {
  const periods: UsagePeriod[] = [];
  let period = getUtcCalendarMonthPeriod(now);
  for (let index = 0; index < monthCount; index += 1) {
    periods.push(period);
    period = getPreviousUtcCalendarMonthPeriod(period);
  }
  return Promise.all(
    periods.map(async (item) => ({
      period: {
        start: item.start.toISOString(),
        end: item.end.toISOString(),
      },
      usage: await aggregatePeriod(userId, item),
    }))
  );
}
