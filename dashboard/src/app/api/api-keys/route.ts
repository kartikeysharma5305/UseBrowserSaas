import { NextResponse } from 'next/server';

import { isAccountDeletionPending } from '@/lib/account-deletion';
import {
  handleValidationError,
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import {
  createPersonalApiKey,
  listPersonalApiKeys,
} from '@/lib/public-api/api-keys';
import { createApiKeySchema } from '@/lib/public-api/schemas';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await listPersonalApiKeys(user.id) });
}

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  if (await isAccountDeletionPending(user.id))
    return jsonError(
      'Account deletion is in progress.',
      403,
      'ACCOUNT_DELETION_IN_PROGRESS'
    );
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return jsonError('Content-Type must be application/json.', 415);
  const parsed = await parseValidatedBody(request, createApiKeySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const key = await createPersonalApiKey(user.id, parsed.data);
    return NextResponse.json(
      { data: key },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return handleValidationError(error);
  }
}
