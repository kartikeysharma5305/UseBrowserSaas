export const SCHEDULER_POLICY = {
  pollIntervalMs: 15_000,
  batchSize: 50,
  recurringLookbackMs: 24 * 60 * 60 * 1000,
  oneTimeGraceMs: 24 * 60 * 60 * 1000,
  occurrenceLeaseMs: 60_000,
  retryDelayMs: 30_000,
  maxAdmissionAttempts: 5,
  maxFutureYears: 5,
} as const;
