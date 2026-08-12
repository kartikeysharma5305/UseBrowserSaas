import { NextRequest, NextResponse } from 'next/server';
import { recordSecurityRejection } from '@/lib/operations/signals';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function configuredMutationOrigin(
  request: NextRequest,
  environment: NodeJS.ProcessEnv
) {
  if (environment.NODE_ENV !== 'production') return request.nextUrl.origin;
  const configured = environment.APP_BASE_URL?.trim();
  if (!configured) return request.nextUrl.origin;
  try {
    const url = new URL(configured);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isTrustedMutationOrigin(
  request: NextRequest,
  environment: NodeJS.ProcessEnv = process.env
) {
  const origin = request.headers.get('origin');
  const expectedOrigin = configuredMutationOrigin(request, environment);
  const fetchSite = request.headers.get('sec-fetch-site');
  return Boolean(
    origin &&
    expectedOrigin &&
    origin === expectedOrigin &&
    (!fetchSite || ['same-origin', 'same-site', 'none'].includes(fetchSite))
  );
}

export function middleware(request: NextRequest) {
  if (!MUTATION_METHODS.has(request.method) || !request.headers.has('cookie'))
    return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith('/api/v1/') ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/billing/webhook'
  )
    return NextResponse.next();

  if (!isTrustedMutationOrigin(request)) {
    recordSecurityRejection('origin');
    return NextResponse.json(
      { error: 'Cross-origin mutation rejected.' },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
