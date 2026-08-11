import { NextRequest, NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { prisma } from '@/lib/db/prisma';
import { sanitizePersistedExecutionError } from '@/lib/execution/errors';
import { presentRunDuration } from '@/lib/runs/duration';

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const agentId = request.nextUrl.searchParams.get('agentId') ?? undefined;

  const runs = await prisma.run.findMany({
    where: {
      agent: {
        userId: user.id,
        ...(agentId ? { id: agentId } : {}),
      },
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          targetWebsite: true,
        },
      },
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  return NextResponse.json({
    data: runs.map((run) => {
      const duration = presentRunDuration(run);
      return {
        id: run.id,
        agentId: run.agentId,
        status: run.status,
        startedAt: duration.startedAt,
        completedAt: run.completedAt,
        duration: duration.duration,
        attemptDuration: duration.attemptDuration,
        result: run.result,
        errorMessage: sanitizePersistedExecutionError(run.errorMessage),
        queuedAt: run.queuedAt,
        attempt: run.attempt,
        createdAt: run.createdAt,
        agent: run.agent,
      };
    }),
  });
}
