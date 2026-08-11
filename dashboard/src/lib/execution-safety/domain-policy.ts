import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import type { ExecutionSafetyPolicy } from './types';
import { SafetyPolicyError } from './types';

const SENSITIVE_DOMAINS = [
  'paypal.com',
  'stripe.com',
  'wise.com',
  'coinbase.com',
  'binance.com',
  '1password.com',
  'lastpass.com',
  'gmail.com',
  'outlook.com',
  'proton.me',
  'aws.amazon.com',
  'console.cloud.google.com',
  'portal.azure.com',
] as const;

function stripIpv6Brackets(value: string) {
  return value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
}

export function canonicalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase().replace(/\.+$/, '');
  if (!raw || raw.length > 253 || /[\s/@?#\\]/.test(raw) || raw.includes('*'))
    throw new Error('Enter a valid domain without paths or wildcards.');
  const unwrapped = stripIpv6Brackets(raw);
  if (isIP(unwrapped)) return unwrapped;
  if (/^[+-]?\d+$/.test(raw) || /^0x/i.test(raw))
    throw new Error('Unusual numeric IP forms are not allowed.');
  const ascii = domainToASCII(raw).toLowerCase().replace(/\.+$/, '');
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii
      .split('.')
      .some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
  )
    throw new Error('Enter a valid domain.');
  return ascii;
}

export function parseSafetyUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafetyPolicyError('UNSAFE_SCHEME_BLOCKED');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new SafetyPolicyError('UNSAFE_SCHEME_BLOCKED');
  if (url.username || url.password)
    throw new SafetyPolicyError('UNSAFE_SCHEME_BLOCKED');
  if (
    url.port &&
    (!/^\d+$/.test(url.port) ||
      Number(url.port) < 1 ||
      Number(url.port) > 65535)
  )
    throw new SafetyPolicyError('UNSAFE_SCHEME_BLOCKED');
  return { url, hostname: canonicalizeDomain(url.hostname) };
}

export function domainMatches(
  hostname: string,
  domain: string,
  includeSubdomains: boolean
) {
  return (
    hostname === domain ||
    (includeSubdomains && hostname.endsWith(`.${domain}`))
  );
}

export function assertStaticUrlAllowed(
  raw: string,
  policy: ExecutionSafetyPolicy
) {
  const parsed = parseSafetyUrl(raw);
  if (
    policy.blockedDomains.some((domain) =>
      domainMatches(parsed.hostname, domain, true)
    )
  )
    throw new SafetyPolicyError('DOMAIN_BLOCKED');
  if (
    policy.sensitiveDomainMode === 'BLOCK' &&
    SENSITIVE_DOMAINS.some((domain) =>
      domainMatches(parsed.hostname, domain, true)
    )
  )
    throw new SafetyPolicyError('SENSITIVE_DOMAIN_BLOCKED');
  if (
    !policy.allowedDomains.some((domain) =>
      domainMatches(parsed.hostname, domain, policy.allowSubdomains)
    )
  )
    throw new SafetyPolicyError('DOMAIN_NOT_ALLOWED');
  return parsed;
}

export function safeEngineDomainPatterns(policy: ExecutionSafetyPolicy) {
  return {
    allowed: policy.allowedDomains.flatMap((domain) =>
      policy.allowSubdomains ? [domain, `*.${domain}`] : [domain]
    ),
    blocked: policy.blockedDomains,
  };
}
