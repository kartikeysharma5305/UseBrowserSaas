import { z } from 'zod';
import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { createBetaFeedback } from '@/lib/beta/feedback';
import { prisma } from '@/lib/db/prisma';

const schema = z
  .object({
    category: z.enum([
      'BUG',
      'USABILITY',
      'FEATURE_REQUEST',
      'RUN_FAILURE',
      'PERFORMANCE',
      'BILLING',
      'OTHER',
    ]),
    message: z.string().trim().min(3).max(2000),
    contextPath: z.string().trim().max(200).optional(),
    runId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const data = await prisma.betaFeedback.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      category: true,
      message: true,
      contextPath: true,
      runId: true,
      status: true,
      releaseVersion: true,
      createdAt: true,
    },
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = await parseValidatedBody(request, schema);
  if (!parsed.ok) return parsed.response;
  try {
    return Response.json(
      { data: await createBetaFeedback({ userId: user.id, ...parsed.data }) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'FEEDBACK_CONTAINS_SECRET')
      return jsonError(
        'Remove credentials or secret values before submitting feedback.',
        400
      );
    if (error instanceof Error && error.message === 'RUN_NOT_FOUND')
      return jsonError('Run not found.', 404);
    return jsonError('Feedback could not be submitted.', 503);
  }
}
