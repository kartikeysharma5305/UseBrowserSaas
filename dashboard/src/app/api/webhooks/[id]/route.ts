import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import {
  webhookIdSchema,
  updateWebhookEndpointSchema,
} from '@/lib/webhooks/schemas';
import {
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  updateWebhookEndpoint,
} from '@/lib/webhooks/service';
import { webhookRouteError } from '@/lib/webhooks/route-error';
import { parseWebhookManagementBody } from '@/lib/webhooks/request';

async function ownedId(params: Promise<{ id: string }>) {
  return webhookIdSchema.safeParse((await params).id);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = await ownedId(params);
  if (!id.success) return jsonError('Webhook endpoint not found.', 404);
  const endpoint = await getWebhookEndpoint(user.id, id.data);
  if (!endpoint) return jsonError('Webhook endpoint not found.', 404);
  return NextResponse.json({ data: endpoint });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = await ownedId(params);
  if (!id.success) return jsonError('Webhook endpoint not found.', 404);
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return jsonError('Content-Type must be application/json.', 415);
  const parsed = await parseWebhookManagementBody(
    request,
    updateWebhookEndpointSchema
  );
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json({
      data: await updateWebhookEndpoint(user.id, id.data, parsed.data),
    });
  } catch (error) {
    return webhookRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const id = await ownedId(params);
  if (!id.success || !(await deleteWebhookEndpoint(user.id, id.data)))
    return jsonError('Webhook endpoint not found.', 404);
  return NextResponse.json({ data: { deleted: true } });
}
