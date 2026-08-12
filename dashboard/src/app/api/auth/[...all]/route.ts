import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';
import { enforceAuthAbuseProtection } from '@/lib/security/auth-abuse';
import { BETA_CONFIG } from '@/lib/beta/config';
import { completeEmailSignupWithLegalAcceptance } from '@/lib/auth/legal-signup';

function handlers() {
  return toNextJsHandler(getAuth());
}

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
  if (new URL(request.url).pathname.endsWith('/sign-up/email'))
    return completeEmailSignupWithLegalAcceptance(request, handlers().POST);
  return handlers().POST(request);
}

export async function DELETE(request: Request) {
  return handlers().DELETE(request);
}

export async function GET(request: Request) {
  return handlers().GET(request);
}

export async function PATCH(request: Request) {
  return handlers().PATCH(request);
}

export async function PUT(request: Request) {
  return handlers().PUT(request);
}

export { POST };
