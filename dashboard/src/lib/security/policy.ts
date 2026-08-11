export const SECURITY_POLICY = {
  bodyBytes: {
    authenticatedJson: 64_000,
    authentication: 16_000,
    publicApi: 32_000,
    webhookManagement: 32_768,
  },
  json: { maxDepth: 12, maxFields: 300 },
  authentication: {
    signup: { identifier: 3, ip: 20 },
    login: { identifier: 8, ip: 60 },
    reset: { identifier: 3, ip: 20 },
    windowMs: 60_000,
  },
  publicApi: { preAuthenticationRequestsPerMinute: 600 },
  webhookCommands: { testPerMinute: 10, replayPerMinute: 20 },
  runAdmission: {
    userRunsPerMinute: 20,
    agentRunsPerMinute: 8,
    queuedRunsPerUser: 10,
    windowMs: 60_000,
  },
} as const;

export function isExecutionAdmissionEnabled() {
  return process.env.EXECUTION_ENABLED?.trim().toLowerCase() !== 'false';
}

export function validateJsonShape(value: unknown) {
  let fields = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > SECURITY_POLICY.json.maxDepth) return false;
    if (!candidate || typeof candidate !== 'object') return true;
    if (Array.isArray(candidate)) {
      fields += candidate.length;
      return (
        fields <= SECURITY_POLICY.json.maxFields &&
        candidate.every((entry) => visit(entry, depth + 1))
      );
    }
    const values = Object.values(candidate as Record<string, unknown>);
    fields += values.length;
    return (
      fields <= SECURITY_POLICY.json.maxFields &&
      values.every((entry) => visit(entry, depth + 1))
    );
  };
  return visit(value, 0);
}
