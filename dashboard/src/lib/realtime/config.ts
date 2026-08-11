const DEFAULTS = {
  heartbeatMs: 15_000,
  fallbackPollMs: 2_000,
  maxConnectionsPerUser: 5,
  maxConnectionsPerRun: 3,
  maxConnectionDurationMs: 30 * 60_000,
  cancellationCheckIntervalMs: 1_000,
} as const;

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`
    );
  }
  return value;
}

export interface RealtimeConfiguration {
  heartbeatMs: number;
  fallbackPollMs: number;
  maxConnectionsPerUser: number;
  maxConnectionsPerRun: number;
  maxConnectionDurationMs: number;
  cancellationCheckIntervalMs: number;
}

export function getRealtimeConfiguration(): RealtimeConfiguration {
  return {
    heartbeatMs: integerEnvironment(
      'SSE_HEARTBEAT_MS',
      DEFAULTS.heartbeatMs,
      5_000,
      60_000
    ),
    fallbackPollMs: integerEnvironment(
      'SSE_FALLBACK_POLL_MS',
      DEFAULTS.fallbackPollMs,
      500,
      30_000
    ),
    maxConnectionsPerUser: integerEnvironment(
      'SSE_MAX_CONNECTIONS_PER_USER',
      DEFAULTS.maxConnectionsPerUser,
      1,
      50
    ),
    maxConnectionsPerRun: integerEnvironment(
      'SSE_MAX_CONNECTIONS_PER_RUN',
      DEFAULTS.maxConnectionsPerRun,
      1,
      20
    ),
    maxConnectionDurationMs: integerEnvironment(
      'SSE_MAX_CONNECTION_DURATION_MS',
      DEFAULTS.maxConnectionDurationMs,
      60_000,
      24 * 60 * 60_000
    ),
    cancellationCheckIntervalMs: integerEnvironment(
      'CANCELLATION_CHECK_INTERVAL_MS',
      DEFAULTS.cancellationCheckIntervalMs,
      250,
      30_000
    ),
  };
}
