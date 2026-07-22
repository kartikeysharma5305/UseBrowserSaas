import { NextRequest, NextResponse } from 'next/server';

import {
  requireAuthenticatedUser,
  jsonError,
  parseValidatedBody,
} from '@/lib/api/route-helpers';
import { createAgentSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';

/**
 * GET /api/agents
 * Returns all agents belonging to the authenticated user
 * Authorization: Session required
 */
export async function GET() {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const agents = await prisma.agent.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return NextResponse.json({ data: agents });
}

/**
 * POST /api/agents
 * Creates a new agent for the authenticated user
 * Validates input against createAgentSchema before persisting
 * Authorization: Session required
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const parsedBody = await parseValidatedBody(request, createAgentSchema);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  try {
    const agent = await prisma.agent.create({
      data: {
        userId: user.id,
        name: parsedBody.data.name,
        description: parsedBody.data.description,
        goal: parsedBody.data.goal,
        targetWebsite: parsedBody.data.targetWebsite,
        status: parsedBody.data.status,
        scheduleType: parsedBody.data.scheduleType,
        scheduleConfig: parsedBody.data.scheduleConfig,
        configuration: parsedBody.data.configuration,
      },
    });

    return NextResponse.json({ data: agent }, { status: 201 });
  } catch {
    return jsonError('Unable to create agent.', 500);
  }
}
