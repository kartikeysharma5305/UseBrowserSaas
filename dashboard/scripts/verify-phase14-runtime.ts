import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium, type BrowserContext, type Page } from 'playwright';

import { prisma } from '../src/lib/db/prisma';
import { getBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import {
  signWebhookBody,
  verifyWebhookSignature,
} from '../src/lib/webhooks/crypto';
import { assertWebhookTarget } from '../src/lib/webhooks/network';
import { registerRuntimeUser } from './runtime-beta-registration';

const origin = 'http://localhost:3001';
const receiverUrl = 'http://127.0.0.1:8787/hook';
const nonce = randomBytes(6).toString('hex');
const password = `Phase14-${nonce}-Disposable!`;
let mode: 'success' | 'server-error' | 'rate-limit' | 'oversize' | 'timeout' =
  'success';
const requests: Array<{
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    requests.push({
      body: Buffer.concat(chunks).toString('utf8'),
      headers: request.headers,
    });
    if (mode === 'timeout') {
      setTimeout(() => {
        response.statusCode = 204;
        response.end();
      }, 1_500);
      return;
    }
    if (mode === 'server-error') response.statusCode = 500;
    else if (mode === 'rate-limit') response.statusCode = 429;
    else response.statusCode = mode === 'oversize' ? 200 : 204;
    response.end(mode === 'oversize' ? 'x'.repeat(4_096) : undefined);
  });
});
await new Promise<void>((resolve) => server.listen(8787, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const ownerContext = await browser.newContext();
const controlContext = await browser.newContext();
const runQueue = getBrowserRunQueue();
let ownerId: string | null = null;
let controlId: string | null = null;
const evidence = {
  oneTimeSecret: false,
  protectedAtRest: false,
  signedExactBody: false,
  testDelivery: false,
  runLifecycle: false,
  replayStableEvent: false,
  serverErrorRetried: false,
  rateLimitRetried: false,
  oversizedBounded: false,
  timeoutRetried: false,
  autoDisabled: false,
  productionPrivateRejected: false,
  crossUserDenied: false,
  deletionStopped: false,
  redactedPayload: false,
  cleanup: false,
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 30_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    'Runtime condition did not become true within its safe bound.'
  );
}

async function register(context: BrowserContext, label: string) {
  const email = `phase14-${label}-${nonce}@example.invalid`;
  const page = await registerRuntimeUser({
    context,
    origin,
    email,
    name: `Phase 14 ${label}`,
    password,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, user };
}

async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, method, body }
  ) as Promise<{ status: number; body: any }>;
}

async function delivery(id: string) {
  return prisma.webhookDelivery.findUnique({ where: { id } });
}

try {
  await runQueue.pause();
  const owner = await register(ownerContext, 'owner');
  const control = await register(controlContext, 'control');
  ownerId = owner.user.id;
  controlId = control.user.id;
  await prisma.user.update({
    where: { id: ownerId },
    data: { planCode: 'INTERNAL', planSource: 'INTERNAL' },
  });

  const created = await api(owner.page, '/api/webhooks', 'POST', {
    name: 'Controlled receiver',
    url: receiverUrl,
    eventTypes: ['run.queued', 'run.canceled', 'run.failed'],
  });
  assert(created.status === 201, 'Webhook endpoint creation failed.');
  const endpointId = created.body.data.id as string;
  const secret = created.body.data.secret as string;
  const listed = await api(owner.page, '/api/webhooks');
  evidence.oneTimeSecret =
    listed.status === 200 && !JSON.stringify(listed.body).includes(secret);
  const stored = await prisma.webhookEndpoint.findUniqueOrThrow({
    where: { id: endpointId },
  });
  evidence.protectedAtRest =
    !stored.secretCiphertext.includes(secret) &&
    !stored.secretIv.includes(secret) &&
    !stored.secretTag.includes(secret);

  const test = await api(
    owner.page,
    `/api/webhooks/${endpointId}/test`,
    'POST'
  );
  assert(test.status === 202, 'Test delivery was not accepted.');
  const deliveredTest = await waitFor(
    () => delivery(test.body.data.deliveryId),
    (item) => item?.status === 'DELIVERED'
  );
  evidence.testDelivery = deliveredTest?.httpStatus === 204;
  const receivedTest = requests.at(-1)!;
  const timestamp = Number(receivedTest.headers['webhook-timestamp']);
  const expected = signWebhookBody({
    secret,
    eventId: String(receivedTest.headers['webhook-id']),
    timestamp,
    rawBody: receivedTest.body,
  });
  evidence.signedExactBody = verifyWebhookSignature(
    expected,
    String(receivedTest.headers['webhook-signature'])
  );

  const agent = await api(owner.page, '/api/agents', 'POST', {
    name: 'Phase 14 disposable Agent',
    goal: 'Return a short answer.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
    scheduleType: 'MANUAL',
    scheduleConfig: {},
    configuration: {
      model: 'groq_llama-3.3-70b-versatile',
      maxSteps: 5,
      timeoutMs: 60000,
      browserSettings: {
        headless: true,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    },
  });
  assert(agent.status === 201, 'Disposable Agent creation failed.');
  const run = await api(
    owner.page,
    `/api/agents/${agent.body.data.id}/run`,
    'POST',
    { variables: {} }
  );
  assert(run.status === 202, 'Run admission failed.');
  const runId = run.body.data.runId as string;
  const queuedEvent = await waitFor(
    () =>
      prisma.webhookEvent.findUnique({
        where: { idempotencyKey: `run:${runId}:webhook:run.queued` },
        include: { deliveries: true },
      }),
    (item) =>
      item?.deliveries.some((item) => item.status === 'DELIVERED') === true
  );
  const canceled = await api(owner.page, `/api/runs/${runId}/cancel`, 'POST', {
    reason: 'Phase 14 runtime drill',
  });
  assert(canceled.status === 200, 'Queued Run cancellation failed.');
  const canceledEvent = await waitFor(
    () =>
      prisma.webhookEvent.findUnique({
        where: { idempotencyKey: `run:${runId}:webhook:run.canceled` },
        include: { deliveries: true },
      }),
    (item) =>
      item?.deliveries.some((item) => item.status === 'DELIVERED') === true
  );
  evidence.runLifecycle =
    Boolean(queuedEvent && canceledEvent) &&
    (await prisma.webhookEvent.count({
      where: { runId, type: { in: ['run.queued', 'run.canceled'] } },
    })) === 2;
  const originalCanceledDelivery = canceledEvent!.deliveries[0];
  const replay = await api(
    owner.page,
    `/api/webhooks/deliveries/${originalCanceledDelivery.id}/replay`,
    'POST'
  );
  assert(replay.status === 202, 'Replay was not accepted.');
  const replayed = await waitFor(
    () => delivery(replay.body.data.deliveryId),
    (item) => item?.status === 'DELIVERED'
  );
  evidence.replayStableEvent =
    replayed?.eventId === canceledEvent!.id &&
    (await prisma.webhookEvent.count({ where: { id: canceledEvent!.id } })) ===
      1;

  async function triggerMode(nextMode: typeof mode) {
    mode = nextMode;
    const response = await api(
      owner.page,
      `/api/webhooks/${endpointId}/test`,
      'POST'
    );
    assert(response.status === 202, `Test mode ${nextMode} was not accepted.`);
    return response.body.data.deliveryId as string;
  }

  const serverErrorId = await triggerMode('server-error');
  await waitFor(
    () => delivery(serverErrorId),
    (item) => (item?.attemptCount ?? 0) >= 2
  );
  mode = 'success';
  const serverErrorDone = await waitFor(
    () => delivery(serverErrorId),
    (item) => item?.status === 'DELIVERED'
  );
  evidence.serverErrorRetried = (serverErrorDone?.attemptCount ?? 0) >= 2;

  const rateId = await triggerMode('rate-limit');
  await waitFor(
    () => delivery(rateId),
    (item) => (item?.attemptCount ?? 0) >= 2
  );
  mode = 'success';
  const rateDone = await waitFor(
    () => delivery(rateId),
    (item) => item?.status === 'DELIVERED'
  );
  evidence.rateLimitRetried = (rateDone?.attemptCount ?? 0) >= 2;

  const oversizedId = await triggerMode('oversize');
  const oversized = await waitFor(
    () => delivery(oversizedId),
    (item) => item?.status === 'FAILED'
  );
  evidence.oversizedBounded = oversized?.failureCode === 'RESPONSE_TOO_LARGE';

  const timeoutId = await triggerMode('timeout');
  await waitFor(
    () => delivery(timeoutId),
    (item) => (item?.attemptCount ?? 0) >= 1 && item?.status === 'PENDING'
  );
  mode = 'success';
  const timeoutDone = await waitFor(
    () => delivery(timeoutId),
    (item) => item?.status === 'DELIVERED'
  );
  evidence.timeoutRetried = (timeoutDone?.attemptCount ?? 0) >= 2;

  const failingId = await triggerMode('server-error');
  const disabledEndpoint = await waitFor(
    () => prisma.webhookEndpoint.findUnique({ where: { id: endpointId } }),
    (item) => item?.status === 'DISABLED',
    45_000
  );
  evidence.autoDisabled =
    disabledEndpoint?.disabledAt !== null &&
    (await delivery(failingId))?.status === 'FAILED';

  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', 'production');
  let rejected = false;
  try {
    await assertWebhookTarget(receiverUrl);
  } catch {
    rejected = true;
  }
  if (previousNodeEnv === undefined)
    Reflect.deleteProperty(process.env, 'NODE_ENV');
  else Reflect.set(process.env, 'NODE_ENV', previousNodeEnv);
  evidence.productionPrivateRejected = rejected;
  evidence.crossUserDenied =
    (await api(control.page, `/api/webhooks/${endpointId}`)).status === 404;

  await api(owner.page, `/api/webhooks/${endpointId}`, 'PATCH', {
    enabled: true,
  });
  mode = 'timeout';
  const deletionDelivery = await api(
    owner.page,
    `/api/webhooks/${endpointId}/test`,
    'POST'
  );
  assert(
    deletionDelivery.status === 202,
    'Deletion boundary delivery was not accepted.'
  );
  const deletion = await api(owner.page, '/api/account/delete', 'POST', {
    confirmation: 'DELETE',
  });
  assert(
    [200, 202].includes(deletion.status),
    'Account deletion did not start.'
  );
  await waitFor(
    () => prisma.webhookEndpoint.count({ where: { userId: owner.user.id } }),
    (count) => count === 0
  );
  evidence.deletionStopped =
    (await prisma.webhookDelivery.count({
      where: { id: deletionDelivery.body.data.deliveryId },
    })) === 0;

  const transmitted = requests.map((request) => request.body).join('\n');
  evidence.redactedPayload =
    !transmitted.includes(secret) &&
    !/executionTask|structuredResult|provider|workerId|queueJobId|storageKey|stripe|variables/i.test(
      transmitted
    );
} finally {
  mode = 'success';
  await runQueue.resume().catch(() => undefined);
  await runQueue.close();
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (ownerId || controlId)
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, controlId].filter((id): id is string => Boolean(id)),
        },
      },
    });
  evidence.cleanup =
    (await prisma.user.count({
      where: {
        id: {
          in: [ownerId, controlId].filter((id): id is string => Boolean(id)),
        },
      },
    })) === 0;
  await prisma.$disconnect();
}

const failed = Object.entries(evidence)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (failed.length)
  throw new Error(`Phase 14 runtime assertions failed: ${failed.join(', ')}`);
console.info(JSON.stringify({ phase: 14, status: 'passed', evidence }));
