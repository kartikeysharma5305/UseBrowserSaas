import { NextResponse } from 'next/server';
import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import {
  webhookDeliveryQuerySchema,
  webhookIdSchema,
} from '@/lib/webhooks/schemas';
import { webhookRouteError } from '@/lib/webhooks/route-error';
import { listWebhookDeliveries } from '@/lib/webhooks/service';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = webhookIdSchema.safeParse((await params).id);
  const query = webhookDeliveryQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!id.success) return jsonError('Webhook endpoint not found.', 404);
  if (!query.success) return jsonError('Invalid delivery query.', 400);
  try {
    return NextResponse.json({
      data: await listWebhookDeliveries(user.id, id.data, query.data.limit),
    });
  } catch (error) {
    return webhookRouteError(error);
  }
}
