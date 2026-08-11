import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { markAllNotificationsRead } from '@/lib/notifications/service';

export async function POST() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const result = await markAllNotificationsRead(user.id);
  return NextResponse.json({ data: { updated: result.count } });
}
