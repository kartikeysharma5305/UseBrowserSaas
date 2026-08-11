import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { agentIdSchema } from '@/lib/api/schemas';
import {
  getOwnedAgentWithVariables,
  replaceOwnedAgentVariables,
} from '@/lib/agents/service';
import { replaceVariablesSchema } from '@/lib/variables/schemas';
import { VariableResolutionError } from '@/lib/variables/resolver';

async function context(params: Promise<{ id: string }>) {
  const user = await requireAuthenticatedUser();
  if (!user) return { response: jsonError('Unauthorized.', 401) } as const;
  const parsed = agentIdSchema.safeParse(await params);
  if (!parsed.success)
    return { response: handleValidationError(parsed.error) } as const;
  return { userId: user.id, agentId: parsed.data.id } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await context(params);
  if ('response' in owner) return owner.response;
  const agent = await getOwnedAgentWithVariables(owner.userId, owner.agentId);
  if (!agent) return jsonError('Agent not found.', 404);
  return NextResponse.json({
    data: { version: agent.variableVersion, variables: agent.variables },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await context(params);
  if ('response' in owner) return owner.response;
  const body = await parseValidatedBody(request, replaceVariablesSchema);
  if (!body.ok) return body.response;
  try {
    const agent = await replaceOwnedAgentVariables(
      owner.userId,
      owner.agentId,
      body.data.variables
    );
    if (!agent) return jsonError('Agent not found.', 404);
    return NextResponse.json({
      data: { version: agent.variableVersion, variables: agent.variables },
    });
  } catch (error) {
    if (error instanceof VariableResolutionError)
      return jsonError(error.message, 400, error.code);
    return jsonError('Unable to update Agent variables.', 500);
  }
}
