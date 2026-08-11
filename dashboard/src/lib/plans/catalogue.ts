import type { PlanCode } from '@prisma/client';

export interface PlanLimits {
  runsPerMonth: number;
  activeRuns: number;
  maxRunDurationMs: number;
  maxStepsPerRun: number;
  executionMsPerMonth: number;
  artifactStorageBytes: bigint;
  maxArtifactBytesPerRun: number;
  maxArtifactsPerRun: number;
  retentionDays: number;
  schedulingEnabled: boolean;
  maxActiveSchedules: number;
  apiKeyRequestsPerMinute: number;
  apiUserRequestsPerMinute: number;
  apiRunCreatesPerMinute: number;
  apiCancellationsPerMinute: number;
  apiRetrievalsPerMinute: number;
  maxWebhookEndpoints: number;
  webhookTestsPerMinute: number;
  webhookReplaysPerMinute: number;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  limits: PlanLimits;
}

const MIB = 1024n * 1024n;
const GIB = 1024n * MIB;

export const PLAN_CATALOGUE: Record<PlanCode, PlanDefinition> = {
  FREE: {
    code: 'FREE',
    name: 'Free',
    limits: {
      runsPerMonth: 25,
      activeRuns: 1,
      maxRunDurationMs: 120_000,
      maxStepsPerRun: 25,
      executionMsPerMonth: 1_800_000,
      artifactStorageBytes: 250n * MIB,
      maxArtifactBytesPerRun: 10 * Number(MIB),
      maxArtifactsPerRun: 10,
      retentionDays: 7,
      schedulingEnabled: false,
      maxActiveSchedules: 0,
      apiKeyRequestsPerMinute: 60,
      apiUserRequestsPerMinute: 120,
      apiRunCreatesPerMinute: 5,
      apiCancellationsPerMinute: 10,
      apiRetrievalsPerMinute: 30,
      maxWebhookEndpoints: 0,
      webhookTestsPerMinute: 0,
      webhookReplaysPerMinute: 0,
    },
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    limits: {
      runsPerMonth: 500,
      activeRuns: 2,
      maxRunDurationMs: 900_000,
      maxStepsPerRun: 100,
      executionMsPerMonth: 72_000_000,
      artifactStorageBytes: 10n * GIB,
      maxArtifactBytesPerRun: 25 * Number(MIB),
      maxArtifactsPerRun: 50,
      retentionDays: 30,
      schedulingEnabled: true,
      maxActiveSchedules: 10,
      apiKeyRequestsPerMinute: 300,
      apiUserRequestsPerMinute: 600,
      apiRunCreatesPerMinute: 30,
      apiCancellationsPerMinute: 60,
      apiRetrievalsPerMinute: 180,
      maxWebhookEndpoints: 5,
      webhookTestsPerMinute: 3,
      webhookReplaysPerMinute: 6,
    },
  },
  INTERNAL: {
    code: 'INTERNAL',
    name: 'Internal',
    limits: {
      runsPerMonth: 5_000,
      activeRuns: 5,
      maxRunDurationMs: 900_000,
      maxStepsPerRun: 200,
      executionMsPerMonth: 900_000_000,
      artifactStorageBytes: 50n * GIB,
      maxArtifactBytesPerRun: 50 * Number(MIB),
      maxArtifactsPerRun: 100,
      retentionDays: 90,
      schedulingEnabled: true,
      maxActiveSchedules: 100,
      apiKeyRequestsPerMinute: 1_000,
      apiUserRequestsPerMinute: 2_000,
      apiRunCreatesPerMinute: 100,
      apiCancellationsPerMinute: 200,
      apiRetrievalsPerMinute: 600,
      maxWebhookEndpoints: 25,
      webhookTestsPerMinute: 20,
      webhookReplaysPerMinute: 60,
    },
  },
};

export function getPlan(code: PlanCode): PlanDefinition {
  const plan = PLAN_CATALOGUE[code];
  if (!plan) throw new Error('Plan configuration is invalid.');
  return plan;
}

export function toClientPlan(plan: PlanDefinition) {
  return {
    code: plan.code,
    name: plan.name,
    limits: {
      ...plan.limits,
      artifactStorageBytes: plan.limits.artifactStorageBytes.toString(),
    },
  };
}
