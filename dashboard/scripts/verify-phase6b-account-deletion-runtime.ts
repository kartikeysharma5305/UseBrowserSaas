import { randomBytes, randomUUID } from 'node:crypto';

import { chromium, type BrowserContext } from 'playwright';
import Stripe from 'stripe';

import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';
import { browserRunJob } from '../src/lib/queue/browser-run-job';
import {
  closeBrowserRunQueue,
  getBrowserRunQueue,
} from '../src/lib/queue/browser-run-queue';
import { prisma } from '../src/lib/db/prisma';

const origin = 'http://localhost:3001';
const secretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
if (!secretKey?.startsWith('sk_test_') || !priceId?.startsWith('price_')) {
  throw new Error('Stripe sandbox configuration is unavailable.');
}
const stripe = new Stripe(secretKey);

async function register(context: BrowserContext, name: string) {
  const page = await context.newPage();
  const token = randomBytes(8).toString('hex');
  const email = `phase6b-delete-${token}@example.invalid`;
  const password = `Sandbox-${randomBytes(12).toString('hex')}!`;
  await page.goto(`${origin}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\/)?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, email, password, user };
}

async function postDeletion(
  page: Awaited<ReturnType<BrowserContext['newPage']>>,
  confirmation: string
) {
  return page.evaluate(async (value) => {
    const response = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: value }),
    });
    return { status: response.status, body: await response.json() };
  }, confirmation);
}

const result = {
  disposableUserRegistered: false,
  activeSessionPrepared: false,
  ownedAgentPrepared: false,
  terminalRunAndEventPrepared: false,
  localArtifactPrepared: false,
  queuedRunAndJobPrepared: false,
  sandboxSubscriptionMapped: false,
  invalidConfirmationRejected: false,
  oneDurableDeletionRecord: false,
  queuedRunCanceled: false,
  queuedJobRemoved: false,
  newRunAdmissionBlocked: false,
  controlledArtifactFailurePersisted: false,
  failureMessageSanitized: false,
  failedDeletionStillBlocksAdmission: false,
  sameDeletionResumed: false,
  localArtifactObjectDeleted: false,
  artifactMetadataDeletedAfterObject: false,
  productDataDeleted: false,
  stripeSubscriptionCanceled: false,
  noAutomaticRefund: false,
  billingRecordRetainedWithoutProfileData: false,
  sessionsInvalidated: false,
  deletedLoginRejected: false,
  durableCompletion: false,
  controlUserUnaffected: false,
  crossUserResourcesUnaffected: false,
};

let failureStage = 'initialization';
const browser = await chromium.launch({ headless: true });
const targetContext = await browser.newContext();
const controlContext = await browser.newContext();

try {
  failureStage = 'register-disposable-users';
  const target = await register(targetContext, 'Phase 6B Delete Sandbox');
  const control = await register(controlContext, 'Phase 6B Control Sandbox');
  result.disposableUserRegistered = true;
  result.activeSessionPrepared =
    (await prisma.session.count({ where: { userId: target.user.id } })) > 0;

  failureStage = 'prepare-owned-resources';
  const agent = await prisma.agent.create({
    data: {
      userId: target.user.id,
      name: 'Disposable deletion agent',
      goal: 'Disposable runtime deletion verification',
      targetWebsite: 'https://example.com',
      configuration: {},
    },
  });
  const terminalRun = await prisma.run.create({
    data: {
      agentId: agent.id,
      status: 'SUCCESS',
      completedAt: new Date(),
      duration: 1,
      result: { success: true },
    },
  });
  await prisma.agentEvent.create({
    data: {
      runId: terminalRun.id,
      sequence: 1,
      type: 'RUN_COMPLETED',
      message: 'Disposable terminal run.',
      data: { success: true },
    },
  });
  result.ownedAgentPrepared = true;
  result.terminalRunAndEventPrepared = true;

  const localStorage = createArtifactStorage('LOCAL');
  const savedArtifact = await localStorage.save({
    runId: terminalRun.id,
    fileName: 'deletion-proof.png',
    mimeType: 'image/png',
    data: Buffer.from('phase-6b-disposable-artifact'),
  });
  const validArtifact = await prisma.runArtifact.create({
    data: {
      runId: terminalRun.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      ...savedArtifact,
    },
  });
  const recoverableArtifact = await prisma.runArtifact.create({
    data: {
      runId: terminalRun.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      storageKey: '../controlled-invalid-key',
      fileName: 'controlled-failure.png',
      mimeType: 'image/png',
      size: 1,
    },
  });
  result.localArtifactPrepared =
    (await localStorage.stat(savedArtifact.storageKey)).size ===
    savedArtifact.size;

  const queuedRun = await prisma.run.create({
    data: {
      agentId: agent.id,
      status: 'QUEUED',
      queueJobId: randomUUID(),
      queuedAt: new Date(),
    },
  });
  await prisma.run.update({
    where: { id: queuedRun.id },
    data: { queueJobId: queuedRun.id },
  });
  const queue = getBrowserRunQueue();
  await queue.add('execute-browser-run', browserRunJob(queuedRun.id), {
    jobId: queuedRun.id,
    delay: 60 * 60 * 1000,
  });
  result.queuedRunAndJobPrepared = Boolean(await queue.getJob(queuedRun.id));

  const controlAgent = await prisma.agent.create({
    data: {
      userId: control.user.id,
      name: 'Isolation control agent',
      goal: 'Remain unchanged',
      targetWebsite: 'https://example.com',
      configuration: {},
    },
  });
  const controlRun = await prisma.run.create({
    data: {
      agentId: controlAgent.id,
      status: 'SUCCESS',
      completedAt: new Date(),
      duration: 1,
    },
  });
  await prisma.agentEvent.create({
    data: {
      runId: controlRun.id,
      sequence: 1,
      type: 'RUN_COMPLETED',
      message: 'Isolation control event.',
    },
  });
  const controlSaved = await localStorage.save({
    runId: controlRun.id,
    fileName: 'control-proof.png',
    mimeType: 'image/png',
    data: Buffer.from('phase-6b-control-artifact'),
  });
  const controlArtifact = await prisma.runArtifact.create({
    data: {
      runId: controlRun.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      ...controlSaved,
    },
  });

  failureStage = 'prepare-sandbox-subscription';
  const customer = await stripe.customers.create({
    email: target.email,
    metadata: { internalUserId: target.user.id },
  });
  const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  const sandboxSubscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    trial_period_days: 3,
    default_payment_method: paymentMethod.id,
    metadata: { internalUserId: target.user.id },
  });
  const mappingDeadline = Date.now() + 45_000;
  let mapped = await prisma.subscription.findUnique({
    where: { userId: target.user.id },
  });
  while (!mapped && Date.now() < mappingDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    mapped = await prisma.subscription.findUnique({
      where: { userId: target.user.id },
    });
  }
  result.sandboxSubscriptionMapped =
    mapped?.stripeSubscriptionId === sandboxSubscription.id;
  if (!mapped) throw new Error('Sandbox subscription webhook was not mapped.');
  const refundsBefore = (await stripe.refunds.list({ limit: 100 })).data.length;

  failureStage = 'invalid-confirmation';
  const invalid = await postDeletion(target.page, 'delete');
  result.invalidConfirmationRejected = invalid.status === 400;

  failureStage = 'cancel-queued-work';
  const first = await postDeletion(target.page, 'DELETE');
  const firstOperation = await prisma.accountDeletion.findUniqueOrThrow({
    where: { userId: target.user.id },
  });
  result.oneDurableDeletionRecord =
    first.status === 202 &&
    firstOperation.status === 'PENDING' &&
    (await prisma.accountDeletion.count({
      where: { userId: target.user.id },
    })) === 1;
  const canceledRun = await prisma.run.findUniqueOrThrow({
    where: { id: queuedRun.id },
  });
  result.queuedRunCanceled = canceledRun.status === 'CANCELED';
  result.queuedJobRemoved = (await queue.getJob(queuedRun.id)) === undefined;
  const blockedAdmission = await target.page.evaluate(async (agentId) => {
    const response = await fetch(`/api/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  }, agent.id);
  result.newRunAdmissionBlocked =
    blockedAdmission.status === 403 &&
    blockedAdmission.body?.code === 'ACCOUNT_DELETION_IN_PROGRESS';

  failureStage = 'controlled-artifact-failure';
  const failed = await postDeletion(target.page, 'DELETE');
  const failedOperation = await prisma.accountDeletion.findUniqueOrThrow({
    where: { userId: target.user.id },
  });
  result.controlledArtifactFailurePersisted =
    failed.status === 500 &&
    failedOperation.id === firstOperation.id &&
    failedOperation.status === 'FAILED' &&
    failedOperation.stage === 'DELETING_ARTIFACTS' &&
    failedOperation.errorCode === 'ACCOUNT_DELETION_FAILED';
  result.failureMessageSanitized =
    Boolean(failedOperation.lastError) &&
    !failedOperation.lastError!.includes(target.email) &&
    !/(cus_|sub_|pm_|sk_|whsec_)/.test(failedOperation.lastError!);
  const blockedDuringFailure = await target.page.evaluate(async (agentId) => {
    const response = await fetch(`/api/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  }, agent.id);
  result.failedDeletionStillBlocksAdmission =
    blockedDuringFailure.status === 403 &&
    blockedDuringFailure.body?.code === 'ACCOUNT_DELETION_IN_PROGRESS';

  failureStage = 'restore-artifact-and-resume';
  const restored = await localStorage.save({
    runId: terminalRun.id,
    fileName: 'controlled-recovery.png',
    mimeType: 'image/png',
    data: Buffer.from('phase-6b-recovered-artifact'),
  });
  await prisma.runArtifact.update({
    where: { id: recoverableArtifact.id },
    data: restored,
  });
  const resumed = await postDeletion(target.page, 'DELETE');
  const completed = await prisma.accountDeletion.findUniqueOrThrow({
    where: { userId: target.user.id },
  });
  result.sameDeletionResumed =
    completed.id === firstOperation.id && completed.attempts >= 3;
  result.durableCompletion =
    resumed.status === 202 &&
    completed.status === 'COMPLETED' &&
    completed.stage === 'COMPLETED' &&
    Boolean(completed.completedAt);

  result.localArtifactObjectDeleted = await Promise.all([
    localStorage.stat(savedArtifact.storageKey).then(
      () => false,
      () => true
    ),
    localStorage.stat(restored.storageKey).then(
      () => false,
      () => true
    ),
  ]).then((values) => values.every(Boolean));
  result.artifactMetadataDeletedAfterObject =
    (await prisma.runArtifact.count({
      where: { id: { in: [validArtifact.id, recoverableArtifact.id] } },
    })) === 0;
  result.productDataDeleted =
    (await prisma.agent.count({ where: { userId: target.user.id } })) === 0;

  failureStage = 'post-deletion-external-state';
  const stripeDeadline = Date.now() + 30_000;
  let stripeState = await stripe.subscriptions.retrieve(sandboxSubscription.id);
  while (stripeState.status !== 'canceled' && Date.now() < stripeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    stripeState = await stripe.subscriptions.retrieve(sandboxSubscription.id);
  }
  result.stripeSubscriptionCanceled = stripeState.status === 'canceled';
  const refundsAfter = (await stripe.refunds.list({ limit: 100 })).data.length;
  result.noAutomaticRefund = refundsAfter === refundsBefore;

  const tombstone = await prisma.user.findUniqueOrThrow({
    where: { id: target.user.id },
    include: { subscription: true },
  });
  result.billingRecordRetainedWithoutProfileData =
    Boolean(tombstone.subscription) &&
    tombstone.subscription?.status === 'CANCELED' &&
    tombstone.email.endsWith('@invalid.local') &&
    tombstone.name === null &&
    tombstone.image === null &&
    tombstone.stripeCustomerId === null &&
    tombstone.planCode === 'FREE';
  const sessionStatus = await target.page.evaluate(async () =>
    fetch('/api/billing/status').then((response) => response.status)
  );
  result.sessionsInvalidated =
    sessionStatus === 401 &&
    (await prisma.session.count({ where: { userId: target.user.id } })) === 0;
  const loginResponse = await target.page.request.post(
    `${origin}/api/auth/sign-in/email`,
    { data: { email: target.email, password: target.password } }
  );
  result.deletedLoginRejected = !loginResponse.ok();

  const controlStillThere = await prisma.user.findUnique({
    where: { id: control.user.id },
  });
  result.controlUserUnaffected =
    controlStillThere?.email === control.email &&
    (await prisma.session.count({ where: { userId: control.user.id } })) > 0;
  result.crossUserResourcesUnaffected =
    Boolean(await prisma.agent.findUnique({ where: { id: controlAgent.id } })) &&
    Boolean(await prisma.run.findUnique({ where: { id: controlRun.id } })) &&
    Boolean(
      await prisma.runArtifact.findUnique({ where: { id: controlArtifact.id } })
    ) &&
    (await localStorage.stat(controlSaved.storageKey)).size === controlSaved.size;

  console.log(JSON.stringify(result));
  if (Object.values(result).some((value) => !value)) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({
      ...result,
      blockedAt: failureStage,
      failureKind: error instanceof Error ? error.name : 'UnknownError',
    })
  );
  process.exitCode = 1;
} finally {
  await closeBrowserRunQueue().catch(() => undefined);
  await targetContext.close();
  await controlContext.close();
  await browser.close();
  await prisma.$disconnect();
}
