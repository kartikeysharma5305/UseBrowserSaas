export interface UsageMetricSummary {
  runs: string;
  attempts: string;
  executionMs: string;
  steps: string;
  artifactBytes: string;
  artifactCount: number;
  inputTokens: string | null;
  outputTokens: string | null;
  totalTokens: string | null;
  terminal: {
    success: string;
    failed: string;
    timedOut: string;
    canceled: string;
  };
}

export interface CurrentUsageResponse {
  plan: {
    code: 'FREE' | 'PRO' | 'INTERNAL';
    name: string;
    limits: {
      runsPerMonth: number;
      activeRuns: number;
      maxRunDurationMs: number;
      maxStepsPerRun: number;
      executionMsPerMonth: number;
      artifactStorageBytes: string;
      maxArtifactBytesPerRun: number;
      maxArtifactsPerRun: number;
      retentionDays: number;
      schedulingEnabled: boolean;
      maxActiveSchedules: number;
    };
  };
  period: { start: string; end: string };
  usage: UsageMetricSummary;
  remaining: {
    runs: string;
    executionMs: string;
    artifactStorageBytes: string;
  };
}

export interface UsageHistoryResponse {
  period: { start: string; end: string };
  usage: UsageMetricSummary;
}
