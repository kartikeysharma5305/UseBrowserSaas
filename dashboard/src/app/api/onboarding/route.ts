import { NextRequest, NextResponse } from 'next/server';

import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { updateOnboardingSchema } from '@/lib/onboarding/schemas';
import { getOnboarding, updateOnboarding } from '@/lib/onboarding/service';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await getOnboarding(user.id) });
}

export async function PATCH(request: NextRequest) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const body = await parseValidatedBody(request, updateOnboardingSchema);
  if (!body.ok) return body.response;
  await updateOnboarding(user.id, body.data.action);
  return NextResponse.json({ data: await getOnboarding(user.id) });
}
