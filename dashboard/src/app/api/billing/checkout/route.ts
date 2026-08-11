import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  parseValidatedBody,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { prisma } from '@/lib/db/prisma';
import { getBillingConfig } from '@/lib/billing/config';
import { getStripePriceForPlan } from '@/lib/billing/price-catalogue';
import { getOrCreateStripeCustomerForUser } from '@/lib/billing/customer';
import { getStripeClient } from '@/lib/billing/stripe-client';

const checkoutBodySchema = z.object({
  plan: z.literal('PRO'),
});

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser();
  if (!user) {
    return jsonError('Unauthorized.', 401);
  }

  const config = getBillingConfig();
  if (!config.enabled)
    return jsonError('Billing is currently disabled.', 503, 'BILLING_DISABLED');

  const parsedBody = await parseValidatedBody(request, checkoutBodySchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  if (user.planSource === 'INTERNAL') {
    return jsonError(
      'Billing checkout is unavailable for internal accounts.',
      403,
      'BILLING_UNAVAILABLE'
    );
  }

  const currentSubscription = await prisma.subscription.findFirst({
    where: {
      userId: user.id,
      status: {
        in: ['ACTIVE', 'TRIALING'],
      },
      planCode: 'PRO',
    },
  });

  if (currentSubscription) {
    return jsonError(
      'An active PRO subscription already exists. Use the customer portal to manage billing.',
      400,
      'ALREADY_SUBSCRIBED'
    );
  }

  const price = getStripePriceForPlan(parsedBody.data.plan);
  const stripeCustomerId = await getOrCreateStripeCustomerForUser(user.id);
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price: price.priceId,
          quantity: 1,
        },
      ],
      success_url: config.checkoutSuccessUrl,
      cancel_url: config.checkoutCancelUrl,
      subscription_data: {
        metadata: {
          internalUserId: user.id,
          plan: parsedBody.data.plan,
        },
      },
    },
    {
      idempotencyKey: `checkout-session-${user.id}-${parsedBody.data.plan}`,
    }
  );

  if (!session.url) {
    return jsonError(
      'Unable to create Stripe Checkout session.',
      500,
      'CHECKOUT_SESSION_FAILED'
    );
  }

  return NextResponse.json({ data: { url: session.url! } }, { status: 201 });
}
