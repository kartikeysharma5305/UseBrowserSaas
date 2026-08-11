import { NextRequest, NextResponse } from 'next/server';
import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { schedulingRouteError } from '@/lib/scheduling/route-error';
import {
  occurrencePaginationSchema,
  scheduleIdSchema,
} from '@/lib/scheduling/schemas';
import { listOccurrences } from '@/lib/scheduling/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = scheduleIdSchema.safeParse(await params);
  if (!id.success) return handleValidationError(id.error);
  const query = occurrencePaginationSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) return handleValidationError(query.error);
  try {
    return NextResponse.json({
      data: await listOccurrences(user.id, id.data.id, query.data),
    });
  } catch (error) {
    return schedulingRouteError(error);
  }
}
