import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
  verifyAgentAccess,
} from '@/lib/api/route-helpers';
import { agentIdSchema, updateAgentSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';

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

  const agent = await verifyAgentAccess(parsed.data.id, user.id);

  if (!agent) {
    return jsonError('Agent not found.', 404);
  }

  return NextResponse.json({ data: agent });
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

  await prisma.agent.delete({
    where: {
      id: parsed.data.id,
    },
  });

  return NextResponse.json({ deleted: true, id: parsed.data.id });
}
