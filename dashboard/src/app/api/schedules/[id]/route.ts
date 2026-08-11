import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { schedulingRouteError } from '@/lib/scheduling/route-error';
import {
  scheduleIdSchema,
  updateScheduleSchema,
} from '@/lib/scheduling/schemas';
import {
  deleteSchedule,
  getSchedule,
  updateSchedule,
} from '@/lib/scheduling/service';

async function ownerAndId(params: Promise<{ id: string }>) {
  const user = await requireAuthenticatedUser();
  if (!user) return { response: jsonError('Unauthorized.', 401) } as const;
  const parsed = scheduleIdSchema.safeParse(await params);
  if (!parsed.success)
    return { response: handleValidationError(parsed.error) } as const;
  return { user, id: parsed.data.id } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await ownerAndId(params);
  if ('response' in context) return context.response;
  try {
    return NextResponse.json({
      data: await getSchedule(context.user.id, context.id),
    });
  } catch (error) {
    return schedulingRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await ownerAndId(params);
  if ('response' in context) return context.response;
  const body = await parseValidatedBody(request, updateScheduleSchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({
      data: await updateSchedule(context.user.id, context.id, body.data),
    });
  } catch (error) {
    return schedulingRouteError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await ownerAndId(params);
  if ('response' in context) return context.response;
  try {
    return NextResponse.json(await deleteSchedule(context.user.id, context.id));
  } catch (error) {
    return schedulingRouteError(error);
  }
}
