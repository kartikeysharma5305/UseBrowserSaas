export const SAFETY_FAILURE_CODES = [
  'DOMAIN_NOT_ALLOWED',
  'DOMAIN_BLOCKED',
  'PRIVATE_NETWORK_BLOCKED',
  'UNSAFE_SCHEME_BLOCKED',
  'REDIRECT_BLOCKED',
  'NAVIGATION_LIMIT_EXCEEDED',
  'PAGE_LIMIT_EXCEEDED',
  'DOWNLOAD_BLOCKED',
  'UPLOAD_BLOCKED',
  'FORM_SUBMISSION_BLOCKED',
  'CREDENTIAL_RETRY_BLOCKED',
  'DESTRUCTIVE_ACTION_BLOCKED',
  'PAYMENT_ACTION_BLOCKED',
  'SENSITIVE_DOMAIN_BLOCKED',
] as const;

export type SafetyFailureCode = (typeof SAFETY_FAILURE_CODES)[number];
export type FormSubmissionMode = 'BLOCKED' | 'SAFE_ONLY' | 'ALLOWED';
export type RedirectPolicy = 'SAME_DOMAIN' | 'ALLOWED_DOMAINS';
export type SensitiveDomainMode = 'BLOCK' | 'ALLOW';

export interface ExecutionSafetyPolicy {
  schemaVersion: 1;
  allowedDomains: string[];
  blockedDomains: string[];
  allowSubdomains: boolean;
  redirectPolicy: RedirectPolicy;
  allowDownloads: boolean;
  allowUploads: boolean;
  formSubmissionMode: FormSubmissionMode;
  allowDestructiveActions: boolean;
  maxNavigations: number;
  maxPages: number;
  sensitiveDomainMode: SensitiveDomainMode;
}

export class SafetyPolicyError extends Error {
  readonly publicMessage: string;

  constructor(readonly code: SafetyFailureCode) {
    const messages: Record<SafetyFailureCode, string> = {
      DOMAIN_NOT_ALLOWED: 'Navigation blocked by domain policy.',
      DOMAIN_BLOCKED: 'Navigation blocked by domain policy.',
      PRIVATE_NETWORK_BLOCKED: 'Navigation blocked by network safety policy.',
      UNSAFE_SCHEME_BLOCKED: 'Navigation blocked by URL safety policy.',
      REDIRECT_BLOCKED: 'Redirect blocked by domain policy.',
      NAVIGATION_LIMIT_EXCEEDED: 'Navigation limit exceeded.',
      PAGE_LIMIT_EXCEEDED: 'Page limit exceeded.',
      DOWNLOAD_BLOCKED: 'Download blocked by execution safety policy.',
      UPLOAD_BLOCKED: 'Upload blocked by execution safety policy.',
      FORM_SUBMISSION_BLOCKED:
        'Form submission blocked by execution safety policy.',
      CREDENTIAL_RETRY_BLOCKED:
        'Repeated credential entry blocked to protect the account.',
      DESTRUCTIVE_ACTION_BLOCKED:
        'Destructive action blocked by execution safety policy.',
      PAYMENT_ACTION_BLOCKED:
        'Payment action blocked by execution safety policy.',
      SENSITIVE_DOMAIN_BLOCKED:
        'Sensitive domain blocked by execution safety policy.',
    };
    super(messages[code]);
    this.name = 'SafetyPolicyError';
    this.publicMessage = messages[code];
  }
}
