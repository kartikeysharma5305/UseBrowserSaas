import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
  verifyAgentAccess,
} from '@/lib/api/route-helpers';
import { agentIdSchema, updateAgentSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';
import { getOwnedAgentWithVariables } from '@/lib/agents/service';
import { detectedPlaceholders } from '@/lib/variables/resolver';
import {
  normalizeSafetyPolicy,
  safetyPolicyInput,
} from '@/lib/execution-safety/policy';

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

  const agent = await getOwnedAgentWithVariables(user.id, parsed.data.id);

  if (!agent) {
    return jsonError('Agent not found.', 404);
  }

  return NextResponse.json({
    data: {
      ...agent,
      safetyPolicy: normalizeSafetyPolicy(
        agent.safetyPolicy,
        agent.targetWebsite
      ),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();

  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const { id } = await params;
  const parsedId = agentIdSchema.safeParse({ id });

  if (!parsedId.success) {
    return handleValidationError(parsedId.error);
  }

  const existingAgent = await verifyAgentAccess(parsedId.data.id, user.id);

  if (!existingAgent) {
    return jsonError('Agent not found.', 404);
  }

  const parsedBody = await parseValidatedBody(request, updateAgentSchema);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  try {
    const declared = new Set(
      (
        await getOwnedAgentWithVariables(user.id, parsedId.data.id)
      )?.variables.map((variable) => variable.key) ?? []
    );
    const undeclared = detectedPlaceholders(
      parsedBody.data.goal ?? existingAgent.goal,
      parsedBody.data.targetWebsite ?? existingAgent.targetWebsite
    ).find((key) => !declared.has(key));
    if (undeclared)
      return jsonError(
        `Declare the ${undeclared} variable before saving.`,
        400
      );
    const effectiveTarget =
      parsedBody.data.targetWebsite ?? existingAgent.targetWebsite;
    const effectivePolicy = normalizeSafetyPolicy(
      parsedBody.data.safetyPolicy ?? existingAgent.safetyPolicy,
      effectiveTarget
    );
    const updatedAgent = await prisma.agent.update({
      where: {
        id: parsedId.data.id,
      },
      data: {
        ...(parsedBody.data.name ? { name: parsedBody.data.name } : {}),
        ...(parsedBody.data.description !== undefined
          ? { description: parsedBody.data.description }
          : {}),
        ...(parsedBody.data.goal ? { goal: parsedBody.data.goal } : {}),
        ...(parsedBody.data.targetWebsite
          ? { targetWebsite: parsedBody.data.targetWebsite }
          : {}),
        ...(parsedBody.data.status ? { status: parsedBody.data.status } : {}),
        ...(parsedBody.data.scheduleType
          ? { scheduleType: parsedBody.data.scheduleType }
          : {}),
        ...(parsedBody.data.scheduleConfig !== undefined
          ? { scheduleConfig: parsedBody.data.scheduleConfig }
          : {}),
        ...(parsedBody.data.configuration
          ? { configuration: parsedBody.data.configuration }
          : {}),
        ...(parsedBody.data.outputSchema !== undefined
          ? {
              outputSchema:
                parsedBody.data.outputSchema === null
                  ? Prisma.JsonNull
                  : (parsedBody.data
                      .outputSchema as unknown as Prisma.InputJsonValue),
            }
          : {}),
        ...(parsedBody.data.safetyPolicy !== undefined ||
        parsedBody.data.targetWebsite !== undefined
          ? { safetyPolicy: safetyPolicyInput(effectivePolicy) }
          : {}),
      },
    });

    return NextResponse.json({ data: updatedAgent });
  } catch {
    return jsonError('Unable to update agent.', 500);
  }
}

export async function DELETE(
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

  const existingAgent = await verifyAgentAccess(parsed.data.id, user.id);

  if (!existingAgent) {
    return jsonError('Agent not found.', 404);
  }

  await prisma.$transaction(async (transaction) => {
    const scheduleIds = await transaction.schedule.findMany({
      where: { agentId: parsed.data.id, userId: user.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const schedule of scheduleIds)
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${schedule.id}`}, 0))`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent:${parsed.data.id}`}, 0))`;
    await transaction.agent.delete({ where: { id: parsed.data.id } });
  });

  return NextResponse.json({ deleted: true, id: parsed.data.id });
}
