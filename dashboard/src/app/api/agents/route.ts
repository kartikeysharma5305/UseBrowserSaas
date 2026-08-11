import { NextRequest, NextResponse } from 'next/server';

import {
  requireAuthenticatedUser,
  jsonError,
  parseValidatedBody,
} from '@/lib/api/route-helpers';
import { createAgentSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';
import { createOwnedAgent } from '@/lib/agents/service';
import { isAccountDeletionPending } from '@/lib/account-deletion';
import { normalizeSafetyPolicy } from '@/lib/execution-safety/policy';

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
    include: { variables: { orderBy: { displayOrder: 'asc' } } },
  });

  return NextResponse.json({
    data: agents.map((agent) => ({
      ...agent,
      safetyPolicy: normalizeSafetyPolicy(
        agent.safetyPolicy,
        agent.targetWebsite
      ),
    })),
  });
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
  if (await isAccountDeletionPending(user.id)) {
    return jsonError(
      'Account deletion is in progress.',
      403,
      'ACCOUNT_DELETION_IN_PROGRESS'
    );
  }

  const parsedBody = await parseValidatedBody(request, createAgentSchema);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  try {
    const agent = await createOwnedAgent(user.id, {
      name: parsedBody.data.name,
      description: parsedBody.data.description,
      goal: parsedBody.data.goal,
      targetWebsite: parsedBody.data.targetWebsite,
      status: parsedBody.data.status,
      scheduleType: parsedBody.data.scheduleType,
      scheduleConfig: parsedBody.data.scheduleConfig,
      configuration: parsedBody.data.configuration,
      variables: parsedBody.data.variables,
      safetyPolicy: parsedBody.data.safetyPolicy,
      outputSchema: parsedBody.data.outputSchema,
    });

    return NextResponse.json({ data: agent }, { status: 201 });
  } catch (error) {
    return jsonError(
      error instanceof Error && error.name === 'VariableResolutionError'
        ? error.message
        : 'Unable to create agent.',
      error instanceof Error && error.name === 'VariableResolutionError'
        ? 400
        : 500
    );
  }
}
