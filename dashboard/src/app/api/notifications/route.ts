import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { notificationPaginationSchema } from '@/lib/notifications/schemas';
import { listNotifications } from '@/lib/notifications/service';

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = notificationPaginationSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) return handleValidationError(parsed.error);
  const rows = await listNotifications(user.id, parsed.data);
  return NextResponse.json({
    data: rows,
    pagination: {
      nextCursor:
        rows.length === parsed.data.limit ? (rows.at(-1)?.id ?? null) : null,
    },
  });
}
