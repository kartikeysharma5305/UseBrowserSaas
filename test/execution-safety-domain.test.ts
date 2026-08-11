import { describe, expect, it } from 'vitest';

import {
  assertStaticUrlAllowed,
  canonicalizeDomain,
  domainMatches,
  parseSafetyUrl,
} from '@/lib/execution-safety/domain-policy';
import { normalizeSafetyPolicy } from '@/lib/execution-safety/policy';
import { SafetyPolicyError } from '@/lib/execution-safety/types';

const policy = (overrides: Record<string, unknown> = {}) =>
  normalizeSafetyPolicy(
    { allowedDomains: ['example.com'], ...overrides },
    'https://example.com'
  );

describe('execution safety domain policy', () => {
  it('allows the exact configured domain', () => {
    expect(assertStaticUrlAllowed('https://example.com/path', policy()).hostname).toBe('example.com');
  });

  it('only allows subdomains when explicitly enabled', () => {
    expect(() => assertStaticUrlAllowed('https://www.example.com', policy())).toThrow(SafetyPolicyError);
    expect(assertStaticUrlAllowed('https://www.example.com', policy({ allowSubdomains: true })).hostname).toBe('www.example.com');
  });

  it.each(['example.com.attacker.test', 'notexample.com'])(
    'rejects suffix-confusion host %s',
    (host) => expect(() => assertStaticUrlAllowed(`https://${host}`, policy({ allowSubdomains: true }))).toThrowError('Navigation blocked by domain policy.')
  );

  it('normalizes case, trailing dots, and IDNs', () => {
    expect(canonicalizeDomain('EXAMPLE.COM.')).toBe('example.com');
    expect(canonicalizeDomain('bücher.example')).toBe('xn--bcher-kva.example');
  });

  it('rejects credentials, unsafe schemes, wildcards, paths and invalid ports', () => {
    for (const url of ['https://user:pass@example.com', 'file:///tmp/x', 'javascript:alert(1)', 'ftp://example.com'])
      expect(() => parseSafetyUrl(url)).toThrow(SafetyPolicyError);
    for (const domain of ['*.example.com', 'example.com/path', 'example.com:443'])
      expect(() => canonicalizeDomain(domain)).toThrow();
    expect(() => parseSafetyUrl('https://example.com:99999')).toThrow();
  });

  it('uses label-aware matching rather than a raw suffix check', () => {
    expect(domainMatches('a.example.com', 'example.com', true)).toBe(true);
    expect(domainMatches('notexample.com', 'example.com', true)).toBe(false);
  });

  it('blocks explicit blocked and source-controlled sensitive domains', () => {
    expect(() => assertStaticUrlAllowed('https://blocked.example.com', policy({ allowedDomains: ['blocked.example.com'], blockedDomains: ['blocked.example.com'] }))).toThrow();
    expect(() => assertStaticUrlAllowed('https://paypal.com', policy({ allowedDomains: ['paypal.com'] }))).toThrowError('Sensitive domain blocked by execution safety policy.');
  });

  it('defaults existing Agents to the explicit target domain and deny-by-default capabilities', () => {
    const result = normalizeSafetyPolicy(null, 'https://Example.com/path');
    expect(result).toMatchObject({
      allowedDomains: ['example.com'],
      allowSubdomains: false,
      redirectPolicy: 'SAME_DOMAIN',
      allowDownloads: false,
      allowUploads: false,
      formSubmissionMode: 'SAFE_ONLY',
      allowDestructiveActions: false,
      sensitiveDomainMode: 'BLOCK',
    });
  });
});
