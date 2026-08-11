import type { PlanCode } from '@prisma/client';

import type { NormalizedAgentConfiguration } from '@/lib/execution/agent-configuration';
import { getArtifactMaxBytesPerRun } from '@/lib/execution/configuration';
import type { PlanDefinition } from '@/lib/plans/catalogue';

export interface RunCostBudgetSnapshot {
  version: 1;
  planCode: PlanCode;
  timeoutMs: number;
  maxSteps: number;
  maxArtifactBytes: number;
  maxArtifacts: number;
  userStorageLimitBytes: string;
  admittedAt: string;
}

export function createRunCostBudget(
  plan: PlanDefinition,
  configuration: NormalizedAgentConfiguration,
  admittedAt: Date
): RunCostBudgetSnapshot {
  return {
    version: 1,
    planCode: plan.code,
    timeoutMs: configuration.timeoutMs,
    maxSteps: configuration.maxSteps,
    maxArtifactBytes: Math.min(
      plan.limits.maxArtifactBytesPerRun,
      getArtifactMaxBytesPerRun()
    ),
    maxArtifacts: plan.limits.maxArtifactsPerRun,
    userStorageLimitBytes: plan.limits.artifactStorageBytes.toString(),
    admittedAt: admittedAt.toISOString(),
  };
}

export function parseRunCostBudget(
  value: unknown
): RunCostBudgetSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const budget = value as Partial<RunCostBudgetSnapshot>;
  if (
    budget.version !== 1 ||
    !['FREE', 'PRO', 'INTERNAL'].includes(String(budget.planCode)) ||
    !Number.isSafeInteger(budget.timeoutMs) ||
    Number(budget.timeoutMs) <= 0 ||
    !Number.isSafeInteger(budget.maxSteps) ||
    Number(budget.maxSteps) <= 0 ||
    !Number.isSafeInteger(budget.maxArtifactBytes) ||
    Number(budget.maxArtifactBytes) < 0 ||
    !Number.isSafeInteger(budget.maxArtifacts) ||
    Number(budget.maxArtifacts) < 0 ||
    typeof budget.userStorageLimitBytes !== 'string' ||
    !/^\d+$/.test(budget.userStorageLimitBytes) ||
    typeof budget.admittedAt !== 'string' ||
    !Number.isFinite(Date.parse(budget.admittedAt))
  ) {
    return null;
  }
  return budget as RunCostBudgetSnapshot;
}
