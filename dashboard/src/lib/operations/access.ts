import { createHash, timingSafeEqual } from 'node:crypto';

import { requireAuthenticatedUser } from '@/lib/api/route-helpers';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function validBearer(request: Request) {
  const configured = process.env.OBSERVABILITY_TOKEN?.trim();
  if (!configured || configured.length < 32) return false;
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get('authorization') ?? ''
  );
  if (!match) return false;
  return timingSafeEqual(digest(configured), digest(match[1]!));
}

export async function authorizeOperatorRequest(request: Request) {
  if (validBearer(request)) return { ok: true as const, via: 'token' as const };
  const user = await requireAuthenticatedUser();
  if (user?.planCode === 'INTERNAL')
    return { ok: true as const, via: 'session' as const, user };
  return { ok: false as const };
}

export function internalResponseHeaders() {
  return {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
