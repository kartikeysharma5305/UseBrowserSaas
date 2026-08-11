import 'server-only';

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

export const BETA_CONFIG = Object.freeze({
  enabled: /^(1|true|yes)$/i.test(process.env.BETA_MODE?.trim() ?? ''),
  maxActiveUsers: positiveInteger(process.env.BETA_MAX_ACTIVE_USERS, 25, 100),
  supportEmail:
    process.env.SUPPORT_CONTACT_EMAIL?.trim() || 'support@example.invalid',
  releaseId: (process.env.APP_RELEASE_ID?.trim() || 'development').slice(0, 80),
  inviteLifetimeDays: positiveInteger(
    process.env.BETA_INVITE_LIFETIME_DAYS,
    7,
    30
  ),
});

export function normalizeBetaEmail(email: string) {
  return email.trim().toLowerCase();
}
