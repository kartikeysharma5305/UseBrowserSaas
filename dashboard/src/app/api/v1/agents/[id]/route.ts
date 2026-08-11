import { agentIdSchema } from '@/lib/api/schemas';
import {
  authorizePublicApi,
  publicApiError,
  publicApiResponse,
} from '@/lib/public-api/auth';
import { getPublicAgent } from '@/lib/public-api/resources';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePublicApi(request, 'agents:read');
  if (!auth.ok) return auth.response;
  const parsed = agentIdSchema.safeParse(await params);
  if (!parsed.success)
    return publicApiError('NOT_FOUND', 'Agent not found.', 404);
  const agent = await getPublicAgent(auth.principal.user.id, parsed.data.id);
  if (!agent) return publicApiError('NOT_FOUND', 'Agent not found.', 404);
  return publicApiResponse(agent);
}
