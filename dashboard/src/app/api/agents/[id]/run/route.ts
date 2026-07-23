import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
  verifyAgentAccess,
} from '@/lib/api/route-helpers';
import { agentIdSchema } from '@/lib/api/schemas';
import { PrismaAgentExecutionService } from '@/lib/execution/prisma-agent-execution-service';

const runAgentBodySchema = z.object({}).strict();

export async function POST(
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

  const ownedAgent = await verifyAgentAccess(parsedId.data.id, user.id);

  if (!ownedAgent) {
    return jsonError('Agent not found.', 404);
  }

  const parsedBody = await parseValidatedBody(request, runAgentBodySchema);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  try {
    const executionService = new PrismaAgentExecutionService();
    const result = await executionService.runAgent({
      agentId: parsedId.data.id,
      userId: user.id,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Unable to execute agent.',
      500
    );
  }
}
