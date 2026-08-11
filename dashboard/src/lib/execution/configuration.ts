export const MIN_EXECUTION_TIMEOUT_MS = 5_000;
export const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;
export const MAX_EXECUTION_TIMEOUT_MS = 15 * 60_000;
export const STALE_RUN_GRACE_MS = 2 * 60_000;

const DEFAULT_ARTIFACT_MAX_BYTES_PER_RUN = 25 * 1024 * 1024;

function parseIntegerSetting(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`${name} must be an integer.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function normalizeExecutionTimeoutMs(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_EXECUTION_TIMEOUT_MS ||
    value > MAX_EXECUTION_TIMEOUT_MS
  ) {
    throw new Error(
      `timeoutMs must be between ${MIN_EXECUTION_TIMEOUT_MS} and ${MAX_EXECUTION_TIMEOUT_MS}.`
    );
  }
  return value;
}

export function getArtifactMaxBytesPerRun(
  rawValue = process.env.ARTIFACT_MAX_BYTES_PER_RUN
): number {
  return parseIntegerSetting(
    'ARTIFACT_MAX_BYTES_PER_RUN',
    rawValue,
    DEFAULT_ARTIFACT_MAX_BYTES_PER_RUN,
    1024 * 1024,
    100 * 1024 * 1024
  );
}

export function getStaleRunThresholdMs(): number {
  return MAX_EXECUTION_TIMEOUT_MS + STALE_RUN_GRACE_MS;
}
