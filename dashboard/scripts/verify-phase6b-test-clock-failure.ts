import { randomBytes } from 'node:crypto';

import { chromium } from 'playwright';
import Stripe from 'stripe';

import { prisma } from '../src/lib/db/prisma';

const origin = 'http://localhost:3001';
const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;

if (
  !secretKey?.startsWith('sk_test_') ||
  !webhookSecret?.startsWith('whsec_') ||
  !priceId?.startsWith('price_')
) {
  throw new Error('Stripe sandbox configuration is unavailable.');
}

const stripe = new Stripe(secretKey);
const result = {
  registeredThroughApplication: false,
  testClockCustomerCreated: false,
  sandboxSubscriptionCreated: false,
  trustedWebhookMappedCustomer: false,
  renewalFailureMethodSet: false,
  renewalAttempted: false,
  genuineInvoicePaymentFailed: false,
  signedWebhookProcessed: false,
  webhookRecordedOnce: false,
  subscriptionStillUnique: false,
  authoritativeStatusPastDue: false,
  validPeriodRetainedPro: false,
  warningSafeAndStatusRedacted: false,
  exactReplayAccepted: false,
  exactReplayIdempotent: false,
};

let failureStage = 'initialization';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  failureStage = 'application-registration';
  const token = randomBytes(8).toString('hex');
  const email = `phase6b-clock-${token}@example.invalid`;
  const password = `Sandbox-${randomBytes(12).toString('hex')}!`;

  await page.goto(`${origin}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill('Phase 6B Clock Sandbox');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\/)?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  result.registeredThroughApplication = true;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) throw new Error('Disposable application user was not persisted.');

  failureStage = 'test-clock-customer';
  const frozenTime = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: frozenTime,
    name: 'Phase 6B renewal failure',
  });
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    email,
    metadata: { internalUserId: user.id },
  });
  result.testClockCustomerCreated = true;

  failureStage = 'sandbox-subscription';
  const failurePaymentMethod = await stripe.paymentMethods.attach(
    'pm_card_chargeCustomerFail',
    { customer: customer.id }
  );
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: failurePaymentMethod.id },
  });
  const sandboxSubscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    trial_period_days: 1,
    default_payment_method: failurePaymentMethod.id,
    metadata: { internalUserId: user.id },
  });
  result.sandboxSubscriptionCreated = true;
  result.renewalFailureMethodSet = true;

  failureStage = 'trusted-webhook-mapping';
  const mappingDeadline = Date.now() + 45_000;
  let mapped = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeCustomerId: true, planCode: true, subscription: true },
  });
  while (
    (!mapped?.stripeCustomerId || !mapped.subscription) &&
    Date.now() < mappingDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    mapped = await prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeCustomerId: true, planCode: true, subscription: true },
    });
  }
  result.trustedWebhookMappedCustomer =
    mapped?.stripeCustomerId === customer.id && Boolean(mapped.subscription);
  if (!mapped?.subscription)
    throw new Error('Checkout webhook did not map the disposable user.');

  failureStage = 'renewal-failure-payment-method';
  if (mapped.subscription.stripeSubscriptionId !== sandboxSubscription.id) {
    throw new Error('Webhook mapped a different sandbox subscription.');
  }

  failureStage = 'test-clock-advance';
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: frozenTime + 2 * 24 * 60 * 60,
  });
  const clockDeadline = Date.now() + 90_000;
  let advancedClock = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (advancedClock.status !== 'ready' && Date.now() < clockDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    advancedClock = await stripe.testHelpers.testClocks.retrieve(clock.id);
  }
  result.renewalAttempted = advancedClock.status === 'ready';

  failureStage = 'invoice-payment-failed-webhook';
  const webhookDeadline = Date.now() + 90_000;
  let failedEvent = await prisma.billingWebhookEvent.findFirst({
    where: {
      type: 'invoice.payment_failed',
      receivedAt: { gte: new Date(frozenTime * 1000) },
    },
    orderBy: { receivedAt: 'desc' },
  });
  while (!failedEvent && Date.now() < webhookDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    failedEvent = await prisma.billingWebhookEvent.findFirst({
      where: {
        type: 'invoice.payment_failed',
        receivedAt: { gte: new Date(frozenTime * 1000) },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }
  if (!failedEvent)
    throw new Error('No recurring invoice payment-failure webhook arrived.');
  const stripeEvent = await stripe.events.retrieve(failedEvent.id);
  const invoice = stripeEvent.data.object as Stripe.Invoice;
  const invoiceSubscription =
    invoice.parent?.subscription_details?.subscription;
  const invoiceSubscriptionId =
    typeof invoiceSubscription === 'string'
      ? invoiceSubscription
      : invoiceSubscription?.id;
  result.genuineInvoicePaymentFailed =
    stripeEvent.type === 'invoice.payment_failed' &&
    invoiceSubscriptionId === mapped.subscription.stripeSubscriptionId;
  result.signedWebhookProcessed = failedEvent.processingState === 'PROCESSED';
  result.webhookRecordedOnce =
    (await prisma.billingWebhookEvent.count({ where: { id: failedEvent.id } })) ===
    1;

  const local = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });
  const authoritative = await stripe.subscriptions.retrieve(
    mapped.subscription.stripeSubscriptionId
  );
  const finalUser = await prisma.user.findUnique({ where: { id: user.id } });
  result.subscriptionStillUnique =
    (await prisma.subscription.count({ where: { userId: user.id } })) === 1;
  result.authoritativeStatusPastDue =
    authoritative.status === 'past_due' && local?.status === 'PAST_DUE';
  result.validPeriodRetainedPro =
    finalUser?.planCode === 'PRO' &&
    Boolean(local?.currentPeriodEnd && local.currentPeriodEnd > new Date());

  const statusResponse = await page.evaluate(async () => {
    const response = await fetch('/api/billing/status');
    return { http: response.status, body: await response.json() };
  });
  const serializedStatus = JSON.stringify(statusResponse.body);
  await page.goto(`${origin}/dashboard/billing`, { waitUntil: 'networkidle' });
  const safeWarningVisible = await page
    .getByText('Your payment needs attention.', { exact: true })
    .isVisible();
  result.warningSafeAndStatusRedacted =
    safeWarningVisible &&
    statusResponse.http === 200 &&
    statusResponse.body?.data?.subscription?.status === 'PAST_DUE' &&
    !/(cus_|sub_|in_|pm_|pi_|decline|cardNumber|payment_method)/i.test(
      serializedStatus
    );

  failureStage = 'exact-event-replay';
  const eventCountBeforeReplay = await prisma.billingWebhookEvent.count();
  const payload = JSON.stringify(stripeEvent);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const replayOne = await fetch(`${origin}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
  const replayTwo = await fetch(`${origin}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
  result.exactReplayAccepted = replayOne.ok && replayTwo.ok;
  result.exactReplayIdempotent =
    (await prisma.billingWebhookEvent.count()) === eventCountBeforeReplay &&
    (await prisma.subscription.count({ where: { userId: user.id } })) === 1;

  console.log(JSON.stringify(result));
  if (Object.values(result).some((value) => !value)) process.exitCode = 1;
} catch (error) {
  const visibleErrorCount = await page
    .locator('[role="alert"], .Error, [data-testid*="error"]')
    .count()
    .catch(() => 0);
  console.log(
    JSON.stringify({
      ...result,
      blockedAt: failureStage,
      failureKind: error instanceof Error ? error.name : 'UnknownError',
      visibleError: visibleErrorCount > 0,
      remainedOnStripe: page.url().startsWith('https://checkout.stripe.com/'),
    })
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
