import { NextResponse } from 'next/server';
import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { webhookIdSchema } from '@/lib/webhooks/schemas';
import { consumeWebhookCommandLimit } from '@/lib/webhooks/rate-limit';
import { webhookRouteError } from '@/lib/webhooks/route-error';
import { replayWebhookDelivery } from '@/lib/webhooks/service';
import { betaExecutionBlocked } from '@/lib/beta/access';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  if (betaExecutionBlocked(user.betaAccessStatus))
    return jsonError(
      'Beta access does not permit webhook replays.',
      403,
      'BETA_ACCESS_BLOCKED'
    );
  const id = webhookIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError('Webhook delivery not found.', 404);
  try {
    if (!(await consumeWebhookCommandLimit(user.id, user.planCode, 'replay')))
      return NextResponse.json(
        { error: 'Too many webhook replay requests.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    return NextResponse.json(
      { data: await replayWebhookDelivery(user.id, id.data) },
      { status: 202 }
    );
  } catch (error) {
    return webhookRouteError(error);
  }
}
