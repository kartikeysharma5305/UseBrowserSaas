import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { notificationIdSchema } from '@/lib/notifications/schemas';
import { markNotificationRead } from '@/lib/notifications/service';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = notificationIdSchema.safeParse(await params);
  if (!parsed.success) return handleValidationError(parsed.error);
  if (!(await markNotificationRead(user.id, parsed.data.id)))
    return jsonError('Notification not found.', 404);
  return NextResponse.json({ data: { read: true } });
}
