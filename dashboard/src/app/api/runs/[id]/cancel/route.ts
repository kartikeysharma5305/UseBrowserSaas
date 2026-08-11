import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
  verifyRunAccess,
} from '@/lib/api/route-helpers';
import { cancelRunSchema, runIdSchema } from '@/lib/api/schemas';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { cancelOwnedRun, RunNotFoundError } from '@/lib/runs/run-cancellation';

async function parseBody(request: NextRequest) {
  const text = await request.text();
  if (!text.trim()) return cancelRunSchema.parse({});
  return cancelRunSchema.parse(JSON.parse(text));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);

  const parsedId = runIdSchema.safeParse(await params);
  if (!parsedId.success) return handleValidationError(parsedId.error);

  // Retained as a route-boundary ownership check; the service checks again.
  const accessible = await verifyRunAccess(parsedId.data.id, user.id);
  if (!accessible) return jsonError('Run not found.', 404, 'RUN_NOT_FOUND');

  let body;
  try {
    body = await parseBody(request);
  } catch (error) {
    return handleValidationError(error);
  }

  try {
    const result = await cancelOwnedRun(parsedId.data.id, user.id, body.reason);
    const code =
      result.status === 'CANCELED'
        ? 'RUN_CANCELED'
        : result.alreadyTerminal
          ? 'RUN_ALREADY_TERMINAL'
          : 'RUN_CANCEL_REQUESTED';
    const status = result.status === 'RUNNING' ? 202 : 200;
    return NextResponse.json({ data: result, code }, { status });
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return jsonError('Run not found.', 404, 'RUN_NOT_FOUND');
    }
    logger.error('Run cancellation request failed', {
      runId: parsedId.data.id,
      error: safeSerializeError(error),
    });
    return jsonError(
      'Cancellation could not be requested. Try again.',
      503,
      'CANCELLATION_UNAVAILABLE'
    );
  }
}
