import { NextRequest, NextResponse } from 'next/server';

import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { notificationPreferenceSchema } from '@/lib/notifications/schemas';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/notifications/service';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await getNotificationPreferences(user.id) });
}

export async function PATCH(request: NextRequest) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const body = await parseValidatedBody(request, notificationPreferenceSchema);
  if (!body.ok) return body.response;
  return NextResponse.json({
    data: await updateNotificationPreferences(user.id, body.data),
  });
}
