import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ExecutionServiceError } from '../dashboard/src/lib/execution/errors.js';
import { redactLogValue } from '../dashboard/src/lib/logger.js';
import {
  isTrustedMutationOrigin,
  middleware,
} from '../dashboard/src/middleware.js';
import { buildSecurityHeaders } from '../dashboard/next.config.js';
import {
  isExecutionAdmissionEnabled,
  SECURITY_POLICY,
  validateJsonShape,
} from '../dashboard/src/lib/security/policy.js';
import { enforceRunAdmissionSecurity } from '../dashboard/src/lib/security/run-admission.js';
import {
  requestNetworkIdentifier,
  securityIdentifier,
} from '../dashboard/src/lib/security/rate-limit.js';
import {
  classifyAuthOperation,
  enforceAuthAbuseProtection,
} from '../dashboard/src/lib/security/auth-abuse.js';
import { getAuthCookiePolicy } from '../dashboard/src/lib/auth/cookie-policy.js';

describe('Phase 20 platform security', () => {
  it('bounds authenticated JSON before parsing and rejects wrong media types', async () => {
    process.env.BETTER_AUTH_SECRET ??=
      'phase20-test-secret-that-is-long-enough';
    process.env.BETTER_AUTH_URL ??= 'http://localhost:3001';
    const { parseValidatedBody } =
      await import('../dashboard/src/lib/api/route-helpers.js');
    const oversized = await parseValidatedBody(
      new Request('https://app.test/api/agents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '999999',
        },
        body: '{}',
      }),
      z.object({})
    );
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.response.status).toBe(413);

    const wrongType = await parseValidatedBody(
      new Request('https://app.test/api/agents', {
        method: 'POST',
        body: '{}',
      }),
      z.object({})
    );
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.response.status).toBe(415);
  });

  it('bounds nested JSON complexity', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth <= SECURITY_POLICY.json.maxDepth; depth += 1)
      nested = { child: nested };
    expect(validateJsonShape(nested)).toBe(false);
    expect(validateJsonShape({ ordinary: ['diagnostic', 42] })).toBe(true);
  });

  it('redacts nested credentials while retaining diagnostics', () => {
    const value = redactLogValue({
      request: {
        authorization: 'Bearer disposable-marker',
        cookie: 'session=disposable-marker',
        nested: {
          webhookSecret: 'whsec_disposablemarker123456789012345',
          runId: 'run-safe',
        },
      },
      message:
        'key bua_test_0123456789abcdef.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
      status: 503,
    }) as any;
    expect(JSON.stringify(value)).not.toContain('disposable-marker');
    expect(JSON.stringify(value)).not.toContain('whsec_');
    expect(JSON.stringify(value)).not.toContain('bua_test_');
    expect(value.request.nested.runId).toBe('run-safe');
    expect(value.status).toBe(503);
  });

  it('rejects cross-origin cookie mutations but leaves bearer APIs unaffected', () => {
    const blocked = middleware(
      new NextRequest('https://app.test/api/agents', {
        method: 'POST',
        headers: {
          cookie: 'session=x',
          origin: 'https://evil.test',
          'sec-fetch-site': 'cross-site',
        },
      })
    );
    expect(blocked.status).toBe(403);
    const allowed = middleware(
      new NextRequest('https://app.test/api/agents', {
        method: 'POST',
        headers: {
          cookie: 'session=x',
          origin: 'https://app.test',
          'sec-fetch-site': 'same-origin',
        },
      })
    );
    expect(allowed.status).toBe(200);
    const bearer = middleware(
      new NextRequest('https://app.test/api/v1/agents', {
        method: 'POST',
        headers: {
          authorization: 'Bearer malformed',
          origin: 'https://client.test',
        },
      })
    );
    expect(bearer.status).toBe(200);
  });

  it('uses the canonical public origin behind Railway without trusting proxy headers', () => {
    const publicOrigin = 'https://web-production-98829.up.railway.app';
    const environment = {
      NODE_ENV: 'production',
      APP_BASE_URL: publicOrigin,
    } as NodeJS.ProcessEnv;
    const railwayRequest = new NextRequest('http://internal:3000/api/agents', {
      method: 'POST',
      headers: {
        cookie: 'session=x',
        origin: publicOrigin,
        host: 'internal:3000',
        'x-forwarded-host': 'web-production-98829.up.railway.app',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(isTrustedMutationOrigin(railwayRequest, environment)).toBe(true);

    for (const origin of ['https://evil.example', 'http://localhost:3001']) {
      const hostileRequest = new NextRequest(
        'http://internal:3000/api/agents',
        {
          method: 'POST',
          headers: {
            cookie: 'session=x',
            origin,
            'x-forwarded-host': 'web-production-98829.up.railway.app',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'same-origin',
          },
        }
      );
      expect(isTrustedMutationOrigin(hostileRequest, environment)).toBe(false);
    }

    const spoofedForwarding = new NextRequest(
      'http://internal:3000/api/agents',
      {
        method: 'POST',
        headers: {
          cookie: 'session=x',
          origin: 'https://evil.example',
          'x-forwarded-host': 'web-production-98829.up.railway.app',
          'x-forwarded-proto': 'https',
          'sec-fetch-site': 'same-origin',
        },
      }
    );
    expect(isTrustedMutationOrigin(spoofedForwarding, environment)).toBe(false);
  });

  it('defines restrictive headers and production-only HSTS', () => {
    const production = Object.fromEntries(
      buildSecurityHeaders(true).map((item) => [item.key, item.value])
    );
    const development = Object.fromEntries(
      buildSecurityHeaders(false).map((item) => [item.key, item.value])
    );
    expect(production['Content-Security-Policy']).toContain(
      "frame-ancestors 'none'"
    );
    expect(production['Content-Security-Policy']).not.toContain(
      "'unsafe-eval'"
    );
    expect(development['Content-Security-Policy']).toContain("'unsafe-eval'");
    expect(production['X-Frame-Options']).toBe('DENY');
    expect(production['X-Content-Type-Options']).toBe('nosniff');
    expect(production['Referrer-Policy']).toBe('no-referrer');
    expect(production['Strict-Transport-Security']).toContain('max-age=');
    expect(development['Strict-Transport-Security']).toBeUndefined();
    expect(JSON.stringify(production)).not.toContain(
      'Access-Control-Allow-Origin'
    );
  });

  it('uses host-scoped HttpOnly SameSite cookies and Secure in production', () => {
    const development = getAuthCookiePolicy(false);
    const production = getAuthCookiePolicy(true);
    expect(production).toMatchObject({
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      },
    });
    expect(development.defaultCookieAttributes.secure).toBe(false);
    expect(production.defaultCookieAttributes).not.toHaveProperty('domain');
  });

  it('hashes rate-limit subjects and trusts proxy identity only when configured', () => {
    expect(securityIdentifier(' User@Example.com ')).toBe(
      securityIdentifier('user@example.com')
    );
    expect(securityIdentifier('user@example.com')).not.toContain(
      'user@example.com'
    );
    const original = process.env.SECURITY_TRUST_PROXY_HEADERS;
    process.env.SECURITY_TRUST_PROXY_HEADERS = 'false';
    const direct = requestNetworkIdentifier(
      new Request('https://app.test', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      })
    );
    process.env.SECURITY_TRUST_PROXY_HEADERS = 'true';
    const trusted = requestNetworkIdentifier(
      new Request('https://app.test', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      })
    );
    process.env.SECURITY_TRUST_PROXY_HEADERS = original;
    expect(direct).not.toBe(trusted);
  });

  it('rate limits signup, login and reset by hashed IP and identifier', async () => {
    expect(classifyAuthOperation('/api/auth/sign-up/email')).toBe('signup');
    expect(classifyAuthOperation('/api/auth/sign-in/email')).toBe('login');
    expect(classifyAuthOperation('/api/auth/forget-password')).toBe('reset');
    const consume = vi.fn(async ({ namespace }: { namespace: string }) => ({
      allowed: !namespace.endsWith(':identifier'),
      retryAfter: 31,
    }));
    const response = await enforceAuthAbuseProtection(
      new Request('https://app.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'target@example.com',
          password: 'never-logged',
        }),
      }),
      consume
    );
    expect(response?.status).toBe(429);
    expect(await response?.text()).not.toContain('target@example.com');
    expect(consume).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(consume.mock.calls)).not.toContain(
      'target@example.com'
    );
  });

  it('blocks emergency, burst and per-user queue admission centrally', async () => {
    const original = process.env.EXECUTION_ENABLED;
    process.env.EXECUTION_ENABLED = 'false';
    expect(isExecutionAdmissionEnabled()).toBe(false);
    await expect(
      enforceRunAdmissionSecurity({ run: { count: vi.fn() } } as any, {
        userId: 'u1',
        agentId: 'a1',
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'EXECUTION_DISABLED' });

    process.env.EXECUTION_ENABLED = 'true';
    const transaction = {
      run: {
        count: vi
          .fn()
          .mockResolvedValueOnce(SECURITY_POLICY.runAdmission.queuedRunsPerUser)
          .mockResolvedValue(0),
      },
    };
    await expect(
      enforceRunAdmissionSecurity(transaction as any, {
        userId: 'u1',
        agentId: 'a1',
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'USER_QUEUE_LIMIT_REACHED' });
    process.env.EXECUTION_ENABLED = original;
  });

  it('exposes safe public execution errors', () => {
    expect(new ExecutionServiceError('RUN_RATE_LIMITED')).toMatchObject({
      status: 429,
    });
    expect(new ExecutionServiceError('EXECUTION_DISABLED')).toMatchObject({
      status: 503,
    });
  });
});
