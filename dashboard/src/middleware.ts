import { NextRequest, NextResponse } from 'next/server';
import { recordSecurityRejection } from '@/lib/operations/signals';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite))
  ) {
    recordSecurityRejection('origin');
    return NextResponse.json(
      { error: 'Cross-origin mutation rejected.' },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
