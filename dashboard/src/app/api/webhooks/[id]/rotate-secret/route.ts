import { NextResponse } from 'next/server';
import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { webhookIdSchema } from '@/lib/webhooks/schemas';
import { rotateWebhookSecret } from '@/lib/webhooks/service';
import { webhookRouteError } from '@/lib/webhooks/route-error';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = webhookIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError('Webhook endpoint not found.', 404);
  try {
    return NextResponse.json(
      { data: await rotateWebhookSecret(user.id, id.data) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return webhookRouteError(error);
  }
}
