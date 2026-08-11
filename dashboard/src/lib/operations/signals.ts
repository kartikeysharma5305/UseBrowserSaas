import { incrementCounter } from './metrics';

export function recordAdmissionRejection(code: string) {
  const reason =
    code === 'USER_RUN_LIMIT_REACHED' || code === 'AGENT_RUN_ALREADY_ACTIVE'
      ? 'active_limit'
      : code.includes('QUOTA')
        ? 'quota'
        : code.includes('COST') || code.includes('BUDGET')
          ? 'cost'
          : code === 'USER_QUEUE_LIMIT_REACHED' || code === 'QUEUE_BACKPRESSURE'
            ? 'queue_overload'
            : code === 'RUN_RATE_LIMITED'
              ? 'other'
              : code === 'EXECUTION_DISABLED'
                ? 'execution_disabled'
                : code === 'ACCOUNT_DELETION_IN_PROGRESS'
                  ? 'account_disabled'
                  : 'other';
  incrementCounter('run_admission_rejections_total', { reason });
  if (code === 'RUN_RATE_LIMITED')
    incrementCounter('security_rejections_total', {
      control: 'run_burst_limit',
    });
  if (reason === 'queue_overload')
    incrementCounter('security_rejections_total', {
      control: 'queue_overload',
    });
  if (reason === 'execution_disabled')
    incrementCounter('security_rejections_total', {
      control: 'execution_disabled',
    });
}

export function recordSecurityRejection(
  control:
    | 'auth_rate_limit'
    | 'api_pre_auth_rate_limit'
    | 'api_rate_limit'
    | 'run_burst_limit'
    | 'queue_overload'
    | 'oversized_body'
    | 'origin'
    | 'execution_disabled'
) {
  incrementCounter('security_rejections_total', { control });
}

export function recordProviderRunOutcome(
  provider: 'groq' | 'nvidia',
  code: string | null
) {
  const providerOutcome =
    code === null
      ? 'success'
      : code === 'PROVIDER_RATE_LIMITED' || code === 'AI_PROVIDER_RATE_LIMITED'
        ? 'rate_limited'
        : code === 'PROVIDER_AUTH_FAILED'
          ? 'auth_failed'
          : code === 'PROVIDER_TIMEOUT'
            ? 'timeout'
            : code === 'PROVIDER_UNAVAILABLE'
              ? 'unavailable'
              : code === 'PROVIDER_BAD_RESPONSE'
                ? 'bad_response'
                : code === 'PROVIDER_MODEL_UNAVAILABLE'
                  ? 'model_unavailable'
                  : 'failed';
  incrementCounter('provider_run_outcomes_total', {
    provider,
    provider_outcome: providerOutcome,
  });
}
