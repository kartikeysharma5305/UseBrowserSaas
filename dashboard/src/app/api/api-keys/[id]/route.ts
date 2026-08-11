import { NextResponse } from 'next/server';
import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { revokePersonalApiKey } from '@/lib/public-api/api-keys';
import { apiKeyIdSchema } from '@/lib/public-api/schemas';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = apiKeyIdSchema.safeParse((await params).id);
  if (!parsed.success) return jsonError('API key not found.', 404);
  const key = await revokePersonalApiKey(user.id, parsed.data);
  if (!key) return jsonError('API key not found.', 404);
  return NextResponse.json({ data: key });
}
