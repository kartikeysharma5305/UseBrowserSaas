import { runIdSchema } from '@/lib/api/schemas';
import {
  authorizePublicApi,
  publicApiError,
  publicApiResponse,
} from '@/lib/public-api/auth';
import { listPublicArtifacts } from '@/lib/public-api/resources';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePublicApi(request, 'artifacts:read', 'retrieval');
  if (!auth.ok) return auth.response;
  const parsed = runIdSchema.safeParse(await params);
  if (!parsed.success)
    return publicApiError('NOT_FOUND', 'Run not found.', 404);
  const artifacts = await listPublicArtifacts(
    auth.principal.user.id,
    parsed.data.id
  );
  if (!artifacts) return publicApiError('NOT_FOUND', 'Run not found.', 404);
  return publicApiResponse(artifacts);
}
