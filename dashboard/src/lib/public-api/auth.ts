import { NextResponse } from 'next/server';

import { authenticateApiKey, type ApiKeyPrincipal } from './api-keys';
import type { ApiKeyScope } from './scopes';
import { checkPublicApiRateLimit, type PublicRateClass } from './rate-limit';
import { SECURITY_POLICY } from '@/lib/security/policy';
import {
  consumeSecurityLimit,
  requestNetworkIdentifier,
} from '@/lib/security/rate-limit';
import { incrementCounter } from '@/lib/operations/metrics';
import { recordSecurityRejection } from '@/lib/operations/signals';

function operation(rateClass: PublicRateClass) {
  return rateClass === 'run-create' ? 'run_create' : rateClass;
}

export function publicApiError(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } }
  );
}

export async function authorizePublicApi(
  request: Request,
  scope: ApiKeyScope,
  rateClass: PublicRateClass = 'general'
): Promise<
  | { ok: true; principal: ApiKeyPrincipal }
  | { ok: false; response: NextResponse }
> {
  try {
    const attempt = await consumeSecurityLimit({
      namespace: 'public-api:unauthenticated',
      subject: requestNetworkIdentifier(request),
      limit: SECURITY_POLICY.publicApi.preAuthenticationRequestsPerMinute,
    });
    if (!attempt.allowed) {
      recordSecurityRejection('api_pre_auth_rate_limit');
      incrementCounter('public_api_requests_total', {
        outcome: 'rate_limited',
        operation: operation(rateClass),
      });
      return {
        ok: false,
        response: publicApiError('RATE_LIMITED', 'Too many requests.', 429, {
          'Retry-After': String(attempt.retryAfter),
        }),
      };
    }
  } catch {
    return {
      ok: false,
      response: publicApiError(
        'RATE_LIMIT_UNAVAILABLE',
        'Request limiting is temporarily unavailable.',
        503,
        { 'Retry-After': '5' }
      ),
    };
  }
  const principal = await authenticateApiKey(request).catch(() => null);
  if (!principal) {
    incrementCounter('public_api_requests_total', {
      outcome: 'unauthorized',
      operation: operation(rateClass),
    });
    return {
      ok: false,
      response: publicApiError('UNAUTHORIZED', 'Authentication required.', 401),
    };
  }
  if (!principal.scopes.has(scope)) {
    incrementCounter('public_api_requests_total', {
      outcome: 'forbidden',
      operation: operation(rateClass),
    });
    return {
      ok: false,
      response: publicApiError(
        'INSUFFICIENT_SCOPE',
        'The API key lacks the required scope.',
        403
      ),
    };
  }
  if (
    rateClass === 'run-create' &&
    ['SUSPENDED', 'ENDED'].includes(principal.user.betaAccessStatus)
  ) {
    return {
      ok: false,
      response: publicApiError(
        'BETA_ACCESS_BLOCKED',
        'Beta access does not permit new executions.',
        403
      ),
    };
  }
  const rate = await checkPublicApiRateLimit({
    keyId: principal.keyId,
    userId: principal.user.id,
    planCode: principal.user.planCode,
    kind: rateClass,
  });
  if (!rate.allowed) {
    if (!rate.unavailable) recordSecurityRejection('api_rate_limit');
    incrementCounter('public_api_requests_total', {
      outcome: rate.unavailable ? 'unavailable' : 'rate_limited',
      operation: operation(rateClass),
    });
    return {
      ok: false,
      response: publicApiError(
        rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
        rate.unavailable
          ? 'Request limiting is temporarily unavailable.'
          : 'Too many requests.',
        rate.unavailable ? 503 : 429,
        { 'Retry-After': String(rate.retryAfter) }
      ),
    };
  }
  incrementCounter('public_api_requests_total', {
    outcome: 'allowed',
    operation: operation(rateClass),
  });
  return { ok: true, principal };
}

export function publicApiResponse(data: unknown, init?: ResponseInit) {
  return NextResponse.json(
    { data },
    {
      ...init,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...init?.headers,
      },
    }
  );
}

export async function readBoundedPublicJson(
  request: Request,
  maxBytes = SECURITY_POLICY.bodyBytes.publicApi
): Promise<
  { ok: true; value: unknown } | { ok: false; response: NextResponse }
> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return {
      ok: false,
      response: publicApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Content-Type must be application/json.',
        415
      ),
    };
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    recordSecurityRejection('oversized_body');
    return {
      ok: false,
      response: publicApiError(
        'PAYLOAD_TOO_LARGE',
        'Request body is too large.',
        413
      ),
    };
  }
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      recordSecurityRejection('oversized_body');
      throw new RangeError();
    }
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      response: publicApiError(
        error instanceof RangeError ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
        error instanceof RangeError
          ? 'Request body is too large.'
          : 'Invalid JSON request body.',
        error instanceof RangeError ? 413 : 400
      ),
    };
  }
}
