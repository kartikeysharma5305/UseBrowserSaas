export const EXECUTION_ERROR_DEFINITIONS = {
  AGENT_NOT_FOUND: {
    status: 404,
    message: 'Agent not found.',
  },
  INVALID_AGENT_CONFIGURATION: {
    status: 400,
    message: 'This agent has an invalid execution configuration.',
  },
  INVALID_RUN_INPUT: {
    status: 400,
    message: 'The Run variables are missing or invalid.',
  },
  SECRET_VARIABLES_UNAVAILABLE: {
    status: 422,
    message: 'Secret variables require secure credentials support.',
  },
  AGENT_RUN_ALREADY_ACTIVE: {
    status: 409,
    message: 'This agent already has an active run.',
  },
  AGENT_SCHEDULING_DISABLED: {
    status: 409,
    message: 'This agent is not enabled for scheduled execution.',
  },
  SCHEDULING_NOT_AVAILABLE: {
    status: 403,
    message: 'Scheduling is unavailable for this plan.',
  },
  ACCOUNT_DELETION_IN_PROGRESS: {
    status: 403,
    message: 'Account deletion is in progress.',
  },
  BETA_ACCESS_SUSPENDED: {
    status: 403,
    message: 'Beta access does not permit new executions.',
  },
  USER_RUN_LIMIT_REACHED: {
    status: 429,
    message: 'You have reached the active run limit. Try again later.',
  },
  USER_QUEUE_LIMIT_REACHED: {
    status: 429,
    message: 'You have too many queued runs. Try again later.',
  },
  RUN_RATE_LIMITED: {
    status: 429,
    message: 'Run admission is temporarily rate limited. Try again later.',
  },
  EXECUTION_DISABLED: {
    status: 503,
    message: 'Agent execution is temporarily unavailable for maintenance.',
  },
  MONTHLY_RUN_LIMIT_REACHED: {
    status: 429,
    message: 'You have reached the monthly run limit for your plan.',
  },
  MONTHLY_EXECUTION_LIMIT_REACHED: {
    status: 429,
    message: 'You have reached the monthly execution budget for your plan.',
  },
  MAX_RUN_DURATION_EXCEEDED: {
    status: 422,
    message: 'This agent exceeds your plan execution duration limit.',
  },
  MAX_STEPS_EXCEEDED: {
    status: 422,
    message: 'This agent exceeds your plan step limit.',
  },
  STORAGE_LIMIT_REACHED: {
    status: 429,
    message: 'You have reached the artifact storage limit for your plan.',
  },
  PLAN_CONFIGURATION_INVALID: {
    status: 503,
    message: 'Plan limits are temporarily unavailable.',
  },
  QUEUE_BACKPRESSURE: {
    status: 429,
    message: 'The execution queue is full. Try again later.',
  },
  QUEUE_UNAVAILABLE: {
    status: 503,
    message: 'Agent execution is temporarily unavailable.',
  },
  RUN_ENQUEUE_FAILED: {
    status: 503,
    message: 'The agent run could not be queued. Try again later.',
  },
  EXECUTION_UNAVAILABLE: {
    status: 503,
    message: 'Agent execution is temporarily unavailable.',
  },
  NETWORK_RESOLUTION_FAILED: {
    status: 503,
    message: 'The destination hostname could not be resolved. Try again later.',
  },
  EXECUTION_TIMED_OUT: {
    status: 504,
    message: 'The agent run exceeded its time limit.',
  },
  BROWSER_START_TIMEOUT: {
    status: 504,
    message: 'The browser did not start in time.',
  },
  NAVIGATION_TIMEOUT: {
    status: 504,
    message: 'The target page did not finish initial navigation in time.',
  },
  PAGE_READY_TIMEOUT: {
    status: 504,
    message: 'The target page could not be read in time.',
  },
  BROWSER_ACTION_TIMEOUT: {
    status: 504,
    message: 'A browser action did not finish in time.',
  },
  SCREENSHOT_TIMEOUT: {
    status: 504,
    message: 'The browser screenshot did not finish in time.',
  },
  EXECUTION_STEP_LIMIT_EXCEEDED: {
    status: 422,
    message: 'The agent run exceeded its step limit.',
  },
  AI_PROVIDER_RATE_LIMITED: {
    status: 503,
    message: 'The AI provider is temporarily rate limited. Try again later.',
  },
  PROVIDER_RATE_LIMITED: {
    status: 503,
    message: 'The AI provider is temporarily rate limited. Try again later.',
  },
  PROVIDER_AUTH_FAILED: {
    status: 503,
    message: 'The selected AI provider is temporarily unavailable.',
  },
  PROVIDER_TIMEOUT: {
    status: 504,
    message: 'The AI provider did not respond in time.',
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'The selected AI provider is temporarily unavailable.',
  },
  PROVIDER_BAD_RESPONSE: {
    status: 502,
    message: 'The AI provider returned an unusable response.',
  },
  PROVIDER_MODEL_UNAVAILABLE: {
    status: 503,
    message: 'The selected AI model is temporarily unavailable.',
  },
  EXECUTION_FAILED: {
    status: 500,
    message:
      'The agent run failed. Review the run details for more information.',
  },
  DOMAIN_NOT_ALLOWED: {
    status: 403,
    message: 'Navigation blocked by domain policy.',
  },
  DOMAIN_BLOCKED: {
    status: 403,
    message: 'Navigation blocked by domain policy.',
  },
  PRIVATE_NETWORK_BLOCKED: {
    status: 403,
    message: 'Navigation blocked by network safety policy.',
  },
  UNSAFE_SCHEME_BLOCKED: {
    status: 403,
    message: 'Navigation blocked by URL safety policy.',
  },
  REDIRECT_BLOCKED: {
    status: 403,
    message: 'Redirect blocked by domain policy.',
  },
  NAVIGATION_LIMIT_EXCEEDED: {
    status: 422,
    message: 'Navigation limit exceeded.',
  },
  PAGE_LIMIT_EXCEEDED: { status: 422, message: 'Page limit exceeded.' },
  DOWNLOAD_BLOCKED: {
    status: 403,
    message: 'Download blocked by execution safety policy.',
  },
  UPLOAD_BLOCKED: {
    status: 403,
    message: 'Upload blocked by execution safety policy.',
  },
  FORM_SUBMISSION_BLOCKED: {
    status: 403,
    message:
      'Form interaction blocked. Enable form interactions for this Agent to fill and submit login forms.',
  },
  CREDENTIAL_RETRY_BLOCKED: {
    status: 403,
    message:
      'Login was not retried because the supplied credentials were already entered once.',
  },
  DESTRUCTIVE_ACTION_BLOCKED: {
    status: 403,
    message: 'Destructive action blocked by execution safety policy.',
  },
  PAYMENT_ACTION_BLOCKED: {
    status: 403,
    message: 'Payment action blocked by execution safety policy.',
  },
  SENSITIVE_DOMAIN_BLOCKED: {
    status: 403,
    message: 'Sensitive domain blocked by execution safety policy.',
  },
} as const;

export type ExecutionErrorCode = keyof typeof EXECUTION_ERROR_DEFINITIONS;

const RETRYABLE_EXECUTION_ERROR_CODES: ReadonlySet<ExecutionErrorCode> =
  new Set([
    'EXECUTION_UNAVAILABLE',
    'NETWORK_RESOLUTION_FAILED',
    'BROWSER_START_TIMEOUT',
    'NAVIGATION_TIMEOUT',
    'PAGE_READY_TIMEOUT',
    'BROWSER_ACTION_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_TIMEOUT',
  ]);

export function isRetryableExecutionCode(code: ExecutionErrorCode): boolean {
  return RETRYABLE_EXECUTION_ERROR_CODES.has(code);
}

export type ExecutionStage =
  | 'agent_lookup'
  | 'configuration'
  | 'artifact_setup'
  | 'queue_reserve'
  | 'queue_enqueue'
  | 'schedule_admission'
  | 'queue_claim'
  | 'heartbeat'
  | 'retry'
  | 'recovery'
  | 'worker_shutdown'
  | 'run_create'
  | 'engine_load'
  | 'llm_create'
  | 'browser_start'
  | 'agent_run'
  | 'agent_result'
  | 'timeout'
  | 'cleanup'
  | 'run_persistence'
  | 'route';

interface ExecutionServiceErrorOptions {
  cause?: unknown;
  stage?: ExecutionStage;
  runId?: string;
  activeRunId?: string;
}

export class ExecutionServiceError extends Error {
  readonly code: ExecutionErrorCode;
  readonly publicMessage: string;
  readonly status: number;
  readonly stage?: ExecutionStage;
  readonly runId?: string;
  readonly activeRunId?: string;

  constructor(
    code: ExecutionErrorCode,
    options: ExecutionServiceErrorOptions = {}
  ) {
    const definition = EXECUTION_ERROR_DEFINITIONS[code];
    super(definition.message, { cause: options.cause });
    this.name = 'ExecutionServiceError';
    this.code = code;
    this.publicMessage = definition.message;
    this.status = definition.status;
    this.stage = options.stage;
    this.runId = options.runId;
    this.activeRunId = options.activeRunId;
  }
}

export function toExecutionServiceError(
  error: unknown,
  code: ExecutionErrorCode = 'EXECUTION_FAILED',
  options: Omit<ExecutionServiceErrorOptions, 'cause'> = {}
) {
  if (error instanceof ExecutionServiceError) {
    return error;
  }

  return new ExecutionServiceError(code, {
    ...options,
    cause: error,
  });
}

function redactSensitiveText(value: string): string {
  let redacted = value;

  for (const name of [
    'GROQ_API_KEY',
    'NVIDIA_API_KEY',
    'BETTER_AUTH_SECRET',
    'DATABASE_URL',
  ] as const) {
    const secret = process.env[name];
    if (secret && secret.length >= 4) {
      redacted = redacted.split(secret).join('[redacted]');
    }
  }

  return redacted
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[database-url]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:gsk_|nvapi-|sk-)[a-z0-9_-]{8,}\b/gi, '[api-key]')
    .replace(/[a-z]:\\[^\r\n"'<>]*/gi, '[path]')
    .replace(
      /\/(?:Users|home|tmp|var|opt|app|workspace)\/[^\s"'<>]*/g,
      '[path]'
    )
    .slice(0, 4000);
}

export function safeSerializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      ...(error.stack
        ? { stack: redactSensitiveText(error.stack) }
        : undefined),
    };
  }

  return {
    name: 'NonError',
    message: redactSensitiveText(
      typeof error === 'string' ? error : 'Unknown internal error'
    ),
  };
}

export function sanitizePersistedExecutionError(
  message: string | null
): string | null {
  if (message === null) {
    return null;
  }

  const safeMessage = Object.values(EXECUTION_ERROR_DEFINITIONS).find(
    (definition) => definition.message === message
  )?.message;

  return safeMessage ?? EXECUTION_ERROR_DEFINITIONS.EXECUTION_FAILED.message;
}
