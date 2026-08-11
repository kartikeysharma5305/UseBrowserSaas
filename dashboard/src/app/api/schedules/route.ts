import { NextRequest, NextResponse } from 'next/server';

import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { schedulingRouteError } from '@/lib/scheduling/route-error';
import { createScheduleSchema } from '@/lib/scheduling/schemas';
import { createSchedule, listSchedules } from '@/lib/scheduling/service';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await listSchedules(user.id) });
}

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const body = await parseValidatedBody(request, createScheduleSchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(
      { data: await createSchedule(user.id, body.data) },
      { status: 201 }
    );
  } catch (error) {
    return schedulingRouteError(error);
  }
}
