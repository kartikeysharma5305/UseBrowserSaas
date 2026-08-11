import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { createWebhookEndpointSchema } from '@/lib/webhooks/schemas';
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
} from '@/lib/webhooks/service';
import { webhookRouteError } from '@/lib/webhooks/route-error';
import { parseWebhookManagementBody } from '@/lib/webhooks/request';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await listWebhookEndpoints(user.id) });
}

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return jsonError('Content-Type must be application/json.', 415);
  const parsed = await parseWebhookManagementBody(
    request,
    createWebhookEndpointSchema
  );
  if (!parsed.ok) return parsed.response;
  try {
    const endpoint = await createWebhookEndpoint(user.id, parsed.data);
    return NextResponse.json(
      { data: endpoint },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return webhookRouteError(error);
  }
}
