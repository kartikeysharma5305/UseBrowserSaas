import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
  verifyRunAccess,
} from '@/lib/api/route-helpers';
import { agentIdSchema } from '@/lib/api/schemas';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const { id } = await params;
  const parsed = agentIdSchema.safeParse({ id });

  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  const run = await verifyRunAccess(parsed.data.id, user.id);

  if (!run) {
    return jsonError('Run not found.', 404);
  }

  return NextResponse.json({ data: run });
}
