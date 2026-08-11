import { NextRequest, NextResponse } from 'next/server';
import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { schedulingRouteError } from '@/lib/scheduling/route-error';
import { scheduleIdSchema } from '@/lib/scheduling/schemas';
import { skipNextOccurrence } from '@/lib/scheduling/service';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = scheduleIdSchema.safeParse(await params);
  if (!parsed.success) return handleValidationError(parsed.error);
  try {
    return NextResponse.json({
      data: await skipNextOccurrence(user.id, parsed.data.id),
    });
  } catch (error) {
    return schedulingRouteError(error);
  }
}
