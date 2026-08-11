import Stripe from 'stripe';

import { prisma } from '../src/lib/db/prisma';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey?.startsWith('sk_test_')) {
  throw new Error('Stripe test configuration is unavailable.');
}

const stripe = new Stripe(secretKey);
const local = await prisma.subscription.findFirst({
  where: { user: { name: 'Phase 6B Sandbox' } },
  orderBy: { createdAt: 'desc' },
  select: {
    userId: true,
    stripeSubscriptionId: true,
    stripeCustomerId: true,
  },
});
if (!local) throw new Error('Disposable sandbox subscription was not found.');

const remote = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
const originalPaymentMethod =
  typeof remote.default_payment_method === 'string'
    ? remote.default_payment_method
    : remote.default_payment_method?.id;

const failingMethod = await stripe.paymentMethods.create({
  type: 'card',
  card: { token: 'tok_chargeCustomerFail' },
});
await stripe.paymentMethods.attach(failingMethod.id, {
  customer: local.stripeCustomerId,
});
await stripe.subscriptions.update(local.stripeSubscriptionId, {
  default_payment_method: failingMethod.id,
});

let paymentRejected = false;
try {
  const invoice = await stripe.invoices.create({
    customer: local.stripeCustomerId,
    subscription: local.stripeSubscriptionId,
    collection_method: 'charge_automatically',
    auto_advance: false,
  });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.pay(finalized.id);
} catch {
  paymentRejected = true;
}

if (originalPaymentMethod) {
  await stripe.subscriptions.update(local.stripeSubscriptionId, {
    default_payment_method: originalPaymentMethod,
  });
}

const deadline = Date.now() + 30_000;
let stored = await prisma.subscription.findUnique({
  where: { userId: local.userId },
});
while (!stored?.paymentFailureAt && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  stored = await prisma.subscription.findUnique({
    where: { userId: local.userId },
  });
}
const failedEvent = await prisma.billingWebhookEvent.findFirst({
  where: { type: 'invoice.payment_failed' },
  orderBy: { receivedAt: 'desc' },
  select: { processingState: true, errorCode: true },
});
const user = await prisma.user.findUnique({
  where: { id: local.userId },
  select: { planCode: true },
});

console.log(
  JSON.stringify({
    paymentRejected,
    signedFailureWebhookProcessed:
      failedEvent?.processingState === 'PROCESSED' && !failedEvent.errorCode,
    safeFailureMarkerPersisted:
      Boolean(stored?.paymentFailureAt) &&
      stored?.paymentFailureCode === 'PAYMENT_FAILED',
    periodPolicyRetainedPro: user?.planCode === 'PRO',
  })
);

await prisma.$disconnect();
