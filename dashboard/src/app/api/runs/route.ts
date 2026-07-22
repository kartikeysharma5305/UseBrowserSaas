import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const runs = await prisma.run.findMany({
    where: {
      agent: {
        userId: user.id,
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

  return NextResponse.json({ data: runs });
}
