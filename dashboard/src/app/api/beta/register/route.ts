import { toNextJsHandler } from 'better-auth/next-js';
import { z } from 'zod';

import { getAuth } from '@/lib/auth';
import { BETA_CONFIG, normalizeBetaEmail } from '@/lib/beta/config';
import {
  acceptBetaInvite,
  releaseBetaInvite,
  reserveBetaInvite,
} from '@/lib/beta/invites';
import { prisma } from '@/lib/db/prisma';
import { recordCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { enforceAuthAbuseProtection } from '@/lib/security/auth-abuse';

const inputSchema = z
  .object({
    inviteToken: z.string().min(32).max(256),
    name: z.string().trim().min(1).max(100),
    email: z.string().email().max(320),
    password: z.string().min(8).max(128),
    legalAccepted: z.literal(true),
  })
  .strict();

export async function POST(request: Request) {
  if (!BETA_CONFIG.enabled)
    return Response.json(
      { message: 'Beta registration is not enabled.' },
      { status: 404 }
    );
  const blocked = await enforceAuthAbuseProtection(request);
  if (blocked) return blocked;
  const parsed = inputSchema.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null)
  );
  if (!parsed.success)
    return Response.json(
      { message: 'Invalid registration request.' },
      { status: 400 }
    );
  const email = normalizeBetaEmail(parsed.data.email);
  let invite: Awaited<ReturnType<typeof reserveBetaInvite>>;
  try {
    invite = await reserveBetaInvite(parsed.data.inviteToken, email);
  } catch {
    return Response.json(
      {
        message:
          'Invitation is invalid, expired, unavailable, or already used.',
      },
      { status: 403 }
    );
  }
  const authHeaders = new Headers(request.headers);
  authHeaders.delete('content-length');
  const authRequest = new Request(
    new URL('/api/auth/sign-up/email', request.url),
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: parsed.data.name,
        email,
        password: parsed.data.password,
      }),
    }
  );
  const response = await toNextJsHandler(getAuth()).POST(authRequest);
  if (!response.ok) {
    await releaseBetaInvite(invite.id);
    return response;
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('USER_NOT_CREATED');
    await acceptBetaInvite(invite.id, user.id);
    await recordCurrentLegalAcceptance(user.id);
    return response;
  } catch {
    await releaseBetaInvite(invite.id).catch(() => undefined);
    return Response.json(
      { message: 'Registration could not be completed safely.' },
      { status: 503 }
    );
  }
}
