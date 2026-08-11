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
import {
  ExecutionServiceError,
  safeSerializeError,
  toExecutionServiceError,
} from '@/lib/execution/errors';
import { PrismaAgentExecutionService } from '@/lib/execution/prisma-agent-execution-service';
import { logger } from '@/lib/logger';
import { isAccountDeletionPending } from '@/lib/account-deletion';
import { variableValuesSchema } from '@/lib/variables/schemas';

const runAgentBodySchema = z
  .object({ variables: variableValuesSchema.optional().default({}) })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let agentId: string | undefined;

  try {
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

    const { id } = await params;
    const parsedId = agentIdSchema.safeParse({ id });

    if (!parsedId.success) {
      return handleValidationError(parsedId.error);
    }
    agentId = parsedId.data.id;

    const ownedAgent = await verifyAgentAccess(agentId, user.id);

    if (!ownedAgent) {
      const failure = new ExecutionServiceError('AGENT_NOT_FOUND', {
        stage: 'agent_lookup',
      });
      return jsonError(failure.publicMessage, failure.status, failure.code);
    }

    const parsedBody = await parseValidatedBody(request, runAgentBodySchema);

    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const executionService = new PrismaAgentExecutionService();
    const result = await executionService.runAgent({
      agentId,
      userId: user.id,
      variables: parsedBody.data.variables,
    });

    return NextResponse.json({ data: result }, { status: 202 });
  } catch (error) {
    const failure = toExecutionServiceError(error, 'EXECUTION_FAILED', {
      stage: 'route',
    });

    if (failure.code !== 'AGENT_NOT_FOUND') {
      logger.error('Agent execution request failed', {
        code: failure.code,
        agentId,
        runId: failure.runId,
        stage: failure.stage,
        error: safeSerializeError(
          failure.cause === undefined ? error : failure.cause
        ),
      });
    }

    return jsonError(failure.publicMessage, failure.status, failure.code, {
      ...(failure.activeRunId ? { activeRunId: failure.activeRunId } : {}),
    });
  }
}
