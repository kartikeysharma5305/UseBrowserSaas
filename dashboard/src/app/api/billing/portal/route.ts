import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { getBillingConfig } from '@/lib/billing/config';
import { getStripeCustomerIdForUser } from '@/lib/billing/customer';
import { getStripeClient } from '@/lib/billing/stripe-client';

export async function POST() {
  const user = await requireAuthenticatedUser();
  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const config = getBillingConfig();
  if (!config.enabled)
    return jsonError('Billing is currently disabled.', 503, 'BILLING_DISABLED');
  const stripeCustomerId = await getStripeCustomerIdForUser(user.id);

  if (!stripeCustomerId) {
    return jsonError(
      'No Stripe customer exists for this account. Complete the billing checkout first.',
      400,
      'NO_STRIPE_CUSTOMER'
    );
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: config.portalReturnUrl,
  });

  if (!session.url) {
    return jsonError(
      'Unable to create Stripe Customer Portal session.',
      500,
      'PORTAL_SESSION_FAILED'
    );
  }

  return NextResponse.json({ data: { url: session.url } });
}
