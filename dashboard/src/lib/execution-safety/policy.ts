import type { Prisma } from '@prisma/client';

import { canonicalizeDomain, parseSafetyUrl } from './domain-policy';
import type { ExecutionSafetyPolicy } from './types';

export const DEFAULT_MAX_NAVIGATIONS = 20;
export const DEFAULT_MAX_PAGES = 3;

function targetDomain(targetWebsite: string): string | null {
  if (targetWebsite.includes('{{')) return null;
  try {
    return parseSafetyUrl(targetWebsite).hostname;
  } catch {
    return null;
  }
}

function domains(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => canonicalizeDomain(String(entry))))];
}

export function normalizeSafetyPolicy(
  raw: Prisma.JsonValue | Record<string, unknown> | null | undefined,
  targetWebsite: string
): ExecutionSafetyPolicy {
  const candidate =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const target = targetDomain(targetWebsite);
  const suppliedAllowed = domains(candidate.allowedDomains);
  const allowedDomains = suppliedAllowed.length
    ? suppliedAllowed
    : target
      ? [target]
      : [];
  const blockedDomains = domains(candidate.blockedDomains);
  if (allowedDomains.length > 32 || blockedDomains.length > 32)
    throw new Error(
      'At most 32 allowed and blocked domains may be configured.'
    );
  if (allowedDomains.some((domain) => blockedDomains.includes(domain)))
    throw new Error('A domain cannot be both allowed and blocked.');
  const boundedInteger = (
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ) =>
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max
      ? Number(value)
      : fallback;
  return {
    schemaVersion: 1,
    allowedDomains,
    blockedDomains,
    allowSubdomains: candidate.allowSubdomains === true,
    redirectPolicy:
      candidate.redirectPolicy === 'ALLOWED_DOMAINS'
        ? 'ALLOWED_DOMAINS'
        : 'SAME_DOMAIN',
    allowDownloads: false,
    allowUploads: false,
    formSubmissionMode: ['BLOCKED', 'SAFE_ONLY', 'ALLOWED'].includes(
      String(candidate.formSubmissionMode)
    )
      ? (candidate.formSubmissionMode as ExecutionSafetyPolicy['formSubmissionMode'])
      : 'SAFE_ONLY',
    allowDestructiveActions: candidate.allowDestructiveActions === true,
    maxNavigations: boundedInteger(
      candidate.maxNavigations,
      DEFAULT_MAX_NAVIGATIONS,
      1,
      100
    ),
    maxPages: boundedInteger(candidate.maxPages, DEFAULT_MAX_PAGES, 1, 10),
    sensitiveDomainMode:
      candidate.sensitiveDomainMode === 'ALLOW' ? 'ALLOW' : 'BLOCK',
  };
}

export function safetyPolicyInput(
  policy: ExecutionSafetyPolicy
): Prisma.InputJsonValue {
  return policy as unknown as Prisma.InputJsonValue;
}
