import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import {
  legalAcceptanceStatus,
  recordCurrentLegalAcceptance,
} from '@/lib/legal/acceptance';

const schema = z.object({
  documents: z
    .array(z.enum(['TERMS', 'PRIVACY', 'ACCEPTABLE_USE']))
    .min(1)
    .max(3),
});

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await legalAcceptanceStatus(user.id) });
}

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const body = await parseValidatedBody(request, schema);
  if (!body.ok) return body.response;
  const status = await recordCurrentLegalAcceptance(
    user.id,
    body.data.documents
  );
  return NextResponse.json({ data: status });
}
