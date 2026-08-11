import 'server-only';

import { NextResponse } from 'next/server';

import { SECURITY_POLICY } from './policy';
import {
  consumeSecurityLimit,
  requestNetworkIdentifier,
  securityIdentifier,
} from './rate-limit';
import { recordSecurityRejection } from '@/lib/operations/signals';

type AuthOperation = 'signup' | 'login' | 'reset';

export function classifyAuthOperation(pathname: string): AuthOperation | null {
  if (
    pathname.endsWith('/sign-up/email') ||
    pathname.endsWith('/beta/register')
  )
    return 'signup';
  if (pathname.endsWith('/sign-in/email')) return 'login';
  if (
    /\/(forget-password|request-password-reset|reset-password)$/.test(pathname)
  )
    return 'reset';
  return null;
}

function error(status: number, retryAfter?: number) {
  return NextResponse.json(
    {
      message:
        status === 429
          ? 'Too many requests. Try again later.'
          : 'Authentication is temporarily unavailable.',
    },
    {
      status,
      headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined,
    }
  );
}

export async function enforceAuthAbuseProtection(
  request: Request,
  consume = consumeSecurityLimit
) {
  const kind = classifyAuthOperation(new URL(request.url).pathname);
  if (!kind) return null;
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return NextResponse.json(
      { message: 'Content-Type must be application/json.' },
      { status: 415 }
    );
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (
    Number.isFinite(declared) &&
    declared > SECURITY_POLICY.bodyBytes.authentication
  ) {
    recordSecurityRejection('oversized_body');
    return NextResponse.json(
      { message: 'Request body is too large.' },
      { status: 413 }
    );
  }

  let identifier = 'unknown';
  try {
    const text = await request.clone().text();
    if (
      Buffer.byteLength(text, 'utf8') > SECURITY_POLICY.bodyBytes.authentication
    ) {
      recordSecurityRejection('oversized_body');
      return NextResponse.json(
        { message: 'Request body is too large.' },
        { status: 413 }
      );
    }
    const body = JSON.parse(text) as { email?: unknown };
    if (typeof body.email === 'string') identifier = body.email;
  } catch {
    // Better Auth retains ownership of validation and its enumeration-safe response.
  }

  const limits = SECURITY_POLICY.authentication[kind];
  try {
    const byIp = await consume({
      namespace: `auth:${kind}:ip`,
      subject: requestNetworkIdentifier(request),
      limit: limits.ip,
    });
    const byIdentifier = await consume({
      namespace: `auth:${kind}:identifier`,
      subject: securityIdentifier(identifier),
      limit: limits.identifier,
    });
    if (!byIp.allowed || !byIdentifier.allowed) {
      recordSecurityRejection('auth_rate_limit');
      return error(429, Math.max(byIp.retryAfter, byIdentifier.retryAfter));
    }
    return null;
  } catch {
    return error(503, 5);
  }
}
