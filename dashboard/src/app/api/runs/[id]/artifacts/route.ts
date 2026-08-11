import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { runIdSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';
import { toArtifactApiRecord } from '@/lib/observability/artifact-api';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);

  const parsed = runIdSchema.safeParse(await params);
  if (!parsed.success) return handleValidationError(parsed.error);

  const run = await prisma.run.findFirst({
    where: {
      id: parsed.data.id,
      agent: { userId: user.id },
    },
    select: {
      artifacts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  if (!run) return jsonError('Run not found.', 404);

  return NextResponse.json({
    data: run.artifacts
      .map(toArtifactApiRecord)
      .filter((artifact) => artifact !== null),
  });
}
