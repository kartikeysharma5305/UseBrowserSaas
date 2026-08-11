import { NextResponse } from 'next/server';

import { getBillingConfig } from '@/lib/billing/config';
import { getStripeClient } from '@/lib/billing/stripe-client';
import { handleStripeWebhookEvent } from '@/lib/billing/webhook';
import { jsonError } from '@/lib/api/route-helpers';
import { incrementCounter } from '@/lib/operations/metrics';

export async function POST(request: Request) {
  incrementCounter('billing_webhook_requests_total', { outcome: 'received' });
  const config = getBillingConfig();
  if (!config.enabled)
    return jsonError('Billing is currently disabled.', 503, 'BILLING_DISABLED');
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return jsonError(
      'Stripe signature header is required.',
      400,
      'STRIPE_SIGNATURE_MISSING'
    );
  }

  const payload = await request.text();
  let event;

  try {
    event = getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      config.webhookSecret
    );
  } catch {
    incrementCounter('billing_webhook_requests_total', { outcome: 'rejected' });
    return jsonError(
      'Invalid Stripe webhook signature.',
      400,
      'STRIPE_SIGNATURE_INVALID'
    );
  }

  try {
    incrementCounter('billing_webhook_requests_total', { outcome: 'verified' });
    await handleStripeWebhookEvent(event);
    incrementCounter('billing_webhook_requests_total', {
      outcome: 'processed',
    });
    return NextResponse.json({ received: true });
  } catch {
    incrementCounter('billing_webhook_requests_total', { outcome: 'failed' });
    return jsonError(
      'Unable to process Stripe webhook.',
      500,
      'WEBHOOK_PROCESSING_FAILED'
    );
  }
}
