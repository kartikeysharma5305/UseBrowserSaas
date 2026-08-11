import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';
import { enforceAuthAbuseProtection } from '@/lib/security/auth-abuse';
import { BETA_CONFIG } from '@/lib/beta/config';

const handlers = toNextJsHandler(auth);

async function POST(request: Request) {
  if (
    BETA_CONFIG.enabled &&
    new URL(request.url).pathname.endsWith('/sign-up/email')
  )
    return Response.json(
      { message: 'Registration requires a valid invitation.' },
      { status: 403 }
    );
  const blocked = await enforceAuthAbuseProtection(request);
  if (blocked) return blocked;
  return handlers.POST(request);
}

export const { DELETE, GET, PATCH, PUT } = handlers;
export { POST };
