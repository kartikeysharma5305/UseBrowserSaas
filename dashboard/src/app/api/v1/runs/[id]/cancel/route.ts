import { runIdSchema } from '@/lib/api/schemas';
import { cancelOwnedRun, RunNotFoundError } from '@/lib/runs/run-cancellation';
import { prisma } from '@/lib/db/prisma';
import {
  authorizePublicApi,
  publicApiError,
  publicApiResponse,
} from '@/lib/public-api/auth';
import { publicCancelSchema } from '@/lib/public-api/schemas';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePublicApi(request, 'runs:cancel', 'cancel');
  if (!auth.ok) return auth.response;
  const parsedId = runIdSchema.safeParse(await params);
  if (!parsedId.success)
    return publicApiError('NOT_FOUND', 'Run not found.', 404);
  let body: unknown = {};
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > 4_000)
    return publicApiError(
      'PAYLOAD_TOO_LARGE',
      'Request body is too large.',
      413
    );
  if (text.trim()) {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return publicApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Content-Type must be application/json.',
        415
      );
    try {
      body = JSON.parse(text);
    } catch {
      return publicApiError(
        'INVALID_REQUEST',
        'Invalid JSON request body.',
        400
      );
    }
  }
  const parsed = publicCancelSchema.safeParse(body);
  if (!parsed.success)
    return publicApiError(
      'INVALID_REQUEST',
      'Invalid cancellation request.',
      400
    );
  try {
    const result = await cancelOwnedRun(
      parsedId.data.id,
      auth.principal.user.id,
      parsed.data.reason
    );
    await prisma.apiAuditEvent.create({
      data: {
        userId: auth.principal.user.id,
        apiKeyId: auth.principal.keyId,
        action: 'API_RUN_CANCELED',
        targetId: result.runId,
      },
    });
    return publicApiResponse(result, {
      status: result.status === 'RUNNING' ? 202 : 200,
    });
  } catch (error) {
    return publicApiError(
      error instanceof RunNotFoundError
        ? 'NOT_FOUND'
        : 'CANCELLATION_UNAVAILABLE',
      error instanceof RunNotFoundError
        ? 'Run not found.'
        : 'Cancellation is temporarily unavailable.',
      error instanceof RunNotFoundError ? 404 : 503
    );
  }
}
