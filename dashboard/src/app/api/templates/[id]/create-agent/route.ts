import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { isAccountDeletionPending } from '@/lib/account-deletion';
import {
  createFromTemplateSchema,
  templateIdSchema,
} from '@/lib/templates/schemas';
import {
  createAgentFromTemplate,
  TemplateNotFoundError,
} from '@/lib/templates/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  if (await isAccountDeletionPending(user.id))
    return jsonError(
      'Account deletion is in progress.',
      403,
      'ACCOUNT_DELETION_IN_PROGRESS'
    );
  const parsedId = templateIdSchema.safeParse(await params);
  if (!parsedId.success) return handleValidationError(parsedId.error);
  const body = await parseValidatedBody(request, createFromTemplateSchema);
  if (!body.ok) return body.response;
  try {
    const created = await createAgentFromTemplate(
      { id: user.id, planCode: user.planCode },
      parsedId.data.id,
      body.data
    );
    return NextResponse.json(
      {
        data: {
          agent: {
            id: created.agent.id,
            name: created.agent.name,
            description: created.agent.description,
            goal: created.agent.goal,
            targetWebsite: created.agent.targetWebsite,
            status: created.agent.status,
          },
          run: created.run,
          runAdmissionError: created.runAdmissionError,
          appliedRecommendation: created.applied,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TemplateNotFoundError)
      return jsonError('Template not found.', 404);
    return jsonError('Unable to create Agent from template.', 500);
  }
}
