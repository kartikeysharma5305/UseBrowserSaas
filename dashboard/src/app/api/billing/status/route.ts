import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { getBillingConfig } from '@/lib/billing/config';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const config = getBillingConfig();
  const userSession = await requireAuthenticatedUser();

  if (!userSession) {
    return jsonError('Unauthorized.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userSession.id },
    select: {
      planCode: true,
      planSource: true,
      stripeCustomerId: true,
    },
  });

  if (!user) {
    return jsonError('User not found.', 404);
  }

  let subscription = null;
  if (user.stripeCustomerId) {
    subscription = await prisma.subscription.findFirst({
      where: { userId: userSession.id },
      orderBy: { currentPeriodEnd: 'desc' },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        canceledAt: true,
        paymentFailureAt: true,
      },
    });
  }

  return NextResponse.json({
    data: {
      billingEnabled: config.enabled,
      testMode: config.testMode,
      planCode: user.planCode,
      planSource: user.planSource,
      subscription,
      actions: {
        canStartCheckout: config.enabled && user.planCode === 'FREE',
        canOpenPortal: config.enabled && Boolean(user.stripeCustomerId),
      },
    },
  });
}
