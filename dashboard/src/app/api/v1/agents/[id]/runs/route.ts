import { agentIdSchema } from '@/lib/api/schemas';
import { toExecutionServiceError } from '@/lib/execution/errors';
import {
  authorizePublicApi,
  publicApiError,
  publicApiResponse,
  readBoundedPublicJson,
} from '@/lib/public-api/auth';
import {
  createIdempotentApiRun,
  IdempotencyConflictError,
  IdempotencyInProgressError,
} from '@/lib/public-api/idempotency';
import { getPublicAgent, getPublicRun } from '@/lib/public-api/resources';
import {
  createPublicRunSchema,
  IDEMPOTENCY_KEY_PATTERN,
} from '@/lib/public-api/schemas';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePublicApi(request, 'runs:create', 'run-create');
  if (!auth.ok) return auth.response;
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
    return publicApiError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      400
    );
  const agentId = agentIdSchema.safeParse(await params);
  if (!agentId.success)
    return publicApiError('NOT_FOUND', 'Agent not found.', 404);
  if (!(await getPublicAgent(auth.principal.user.id, agentId.data.id)))
    return publicApiError('NOT_FOUND', 'Agent not found.', 404);
  const body = await readBoundedPublicJson(request);
  if (!body.ok) return body.response;
  const parsed = createPublicRunSchema.safeParse(body.value);
  if (!parsed.success)
    return publicApiError('INVALID_REQUEST', 'Invalid Run variables.', 400);
  try {
    const result = await createIdempotentApiRun({
      apiKeyId: auth.principal.keyId,
      userId: auth.principal.user.id,
      agentId: agentId.data.id,
      idempotencyKey,
      variables: parsed.data.variables,
    });
    const run = await getPublicRun(auth.principal.user.id, result.runId);
    return publicApiResponse(
      { ...run, idempotencyReplayed: result.replayed },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof IdempotencyConflictError)
      return publicApiError(
        'IDEMPOTENCY_CONFLICT',
        'The key was already used with a different request.',
        409
      );
    if (error instanceof IdempotencyInProgressError)
      return publicApiError(
        'IDEMPOTENCY_IN_PROGRESS',
        'The original request is still processing.',
        409,
        { 'Retry-After': '1' }
      );
    const failure = toExecutionServiceError(error, 'EXECUTION_FAILED', {
      stage: 'route',
    });
    return publicApiError(failure.code, failure.publicMessage, failure.status);
  }
}
