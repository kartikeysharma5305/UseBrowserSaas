import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { listTemplatesForPlan } from '@/lib/templates/service';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: listTemplatesForPlan(user.planCode) });
}
