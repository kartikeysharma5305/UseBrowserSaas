import {
  authorizePublicApi,
  publicApiError,
  publicApiResponse,
} from '@/lib/public-api/auth';
import {
  InvalidCursorError,
  listPublicAgents,
} from '@/lib/public-api/resources';
import { publicListQuerySchema } from '@/lib/public-api/schemas';

export async function GET(request: Request) {
  const auth = await authorizePublicApi(request, 'agents:read');
  if (!auth.ok) return auth.response;
  const parsed = publicListQuerySchema
    .pick({ limit: true, cursor: true, status: true })
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    return publicApiError(
      'INVALID_REQUEST',
      'Invalid pagination or filter.',
      400
    );
  try {
    return publicApiResponse(
      await listPublicAgents(auth.principal.user.id, parsed.data)
    );
  } catch (error) {
    return publicApiError(
      error instanceof InvalidCursorError ? 'INVALID_CURSOR' : 'UNAVAILABLE',
      error instanceof InvalidCursorError
        ? 'Invalid cursor or filter.'
        : 'The API is temporarily unavailable.',
      error instanceof InvalidCursorError ? 400 : 503
    );
  }
}
