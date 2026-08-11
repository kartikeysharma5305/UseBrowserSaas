import Stripe from 'stripe';

import { prisma } from '../src/lib/db/prisma';

const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (
  !secretKey?.startsWith('sk_test_') ||
  !webhookSecret?.startsWith('whsec_')
) {
  throw new Error('Stripe test configuration is unavailable.');
}

const stripe = new Stripe(secretKey);
const user = await prisma.user.findFirst({
  where: { name: 'Phase 6B Sandbox', subscription: { isNot: null } },
  orderBy: { createdAt: 'desc' },
  select: {
    id: true,
    planCode: true,
    subscription: {
      select: {
        stripeSubscriptionId: true,
        status: true,
        currentPeriodEnd: true,
      },
    },
  },
});
if (!user?.subscription)
  throw new Error('Disposable sandbox subscription was not found.');

const subscriptionCountBefore = await prisma.subscription.count({
  where: { userId: user.id },
});
const periodBefore = user.subscription.currentPeriodEnd?.getTime() ?? null;

await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
  cancel_at_period_end: true,
});

const deadline = Date.now() + 30_000;
let local = await prisma.subscription.findUnique({
  where: { userId: user.id },
});
while (!local?.cancelAtPeriodEnd && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  local = await prisma.subscription.findUnique({ where: { userId: user.id } });
}

const processedUpdate = await prisma.billingWebhookEvent.findFirst({
  where: {
    type: 'customer.subscription.updated',
    processingState: 'PROCESSED',
  },
  orderBy: { receivedAt: 'desc' },
  select: { id: true },
});
if (!processedUpdate)
  throw new Error('Processed cancellation webhook was not found.');

const event = await stripe.events.retrieve(processedUpdate.id);
const payload = JSON.stringify(event);
const signature = stripe.webhooks.generateTestHeaderString({
  payload,
  secret: webhookSecret,
});
const eventCountBeforeReplay = await prisma.billingWebhookEvent.count();
const replayOne = await fetch('http://localhost:3001/api/billing/webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': signature,
  },
  body: payload,
});
const replayTwo = await fetch('http://localhost:3001/api/billing/webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': signature,
  },
  body: payload,
});
const eventCountAfterReplay = await prisma.billingWebhookEvent.count();
const subscriptionCountAfter = await prisma.subscription.count({
  where: { userId: user.id },
});
const finalUser = await prisma.user.findUnique({
  where: { id: user.id },
  select: { planCode: true },
});

console.log(
  JSON.stringify({
    cancellationPersisted: local?.cancelAtPeriodEnd === true,
    periodPersisted:
      Boolean(local?.currentPeriodEnd) &&
      local?.currentPeriodEnd?.getTime() === periodBefore,
    accessRemainsPro: finalUser?.planCode === 'PRO',
    cancellationWebhookProcessed: true,
    exactReplayAccepted: replayOne.status === 200 && replayTwo.status === 200,
    webhookReplayIdempotent: eventCountAfterReplay === eventCountBeforeReplay,
    subscriptionStillUnique:
      subscriptionCountBefore === 1 && subscriptionCountAfter === 1,
  })
);

await prisma.$disconnect();
