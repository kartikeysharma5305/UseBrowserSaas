import { randomBytes } from 'node:crypto';

import type { NotificationType, RunStatus } from '@prisma/client';

import { prisma } from '../src/lib/db/prisma';
import { NotificationDeliveryProcessor } from '../src/lib/notifications/delivery-processor';
import {
  createRunTerminalNotification,
  emitScheduleAlert,
} from '../src/lib/notifications/events';
import {
  closeNotificationDeliveryQueue,
  getNotificationDeliveryQueue,
} from '../src/lib/notifications/queue';

const origin = process.env.APP_BASE_URL ?? 'http://localhost:3001';
const nonce = randomBytes(8).toString('hex');

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function cookies(response: Response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  return values
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

async function signup(label: string) {
  const email = `phase7-${label}-${nonce}@example.invalid`;
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email,
      password: `Phase7-${nonce}-disposable!`,
      name: `Phase 7 ${label}`,
    }),
  });
  const body = (await response.json()) as { user?: { id?: string } };
  assert(response.ok && body.user?.id, 'Disposable signup failed.');
  return { userId: body.user.id, email, cookie: cookies(response) };
}

async function api(
  session: { cookie: string },
  path: string,
  method = 'GET',
  body?: unknown
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Cookie: session.cookie,
      Origin: origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {}
  return { status: response.status, payload };
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

async function createAgentAndFailedRun(
  session: { cookie: string },
  label: string
) {
  const agentResponse = await api(session, '/api/agents', 'POST', {
    name: `Phase 7 ${label}`,
    description: 'Disposable notification runtime resource',
    goal: 'Open the unreachable local test endpoint and stop.',
    targetWebsite: 'http://127.0.0.1:1',
    status: 'ACTIVE',
    scheduleType: 'MANUAL',
    scheduleConfig: {},
    configuration: {
      model: 'groq_llama-3.3-70b-versatile',
      maxSteps: 1,
      timeoutMs: 5_000,
      browserSettings: {
        headless: true,
        viewportWidth: 800,
        viewportHeight: 600,
      },
    },
  });
  assert(agentResponse.status === 201, 'Disposable Agent creation failed.');
  const agentId = (agentResponse.payload as { data: { id: string } }).data.id;
  const runResponse = await api(
    session,
    `/api/agents/${agentId}/run`,
    'POST',
    {}
  );
  assert(runResponse.status === 202, 'Real Run admission failed.');
  const runId = (runResponse.payload as { data: { runId: string } }).data.runId;
  const run = await waitFor(() =>
    prisma.run.findFirst({
      where: { id: runId, status: { in: ['FAILED', 'TIMED_OUT'] } },
      select: { id: true, status: true, completedAt: true },
    })
  );
  assert(run, 'Real Run did not reach FAILED or TIMED_OUT.');
  return { agentId, run };
}

const result = {
  disabledStartup: false,
  realTerminalRunDelivered: false,
  duplicateTerminalSuppressed: false,
  scheduleBlockDeliveredOnce: false,
  preferenceSuppressedDelivery: false,
  crossUserIsolation: false,
  redaction: false,
  deletionCompletedDespiteProviderFailure: false,
};

let queuePaused = false;
let stage = 'startup';
try {
  assert(
    process.env.EMAIL_ENABLED === 'true',
    'Runtime drill requires EMAIL_ENABLED=true.'
  );
  assert(
    process.env.EMAIL_PROVIDER === 'development',
    'Runtime drill requires development provider.'
  );
  await prisma.$queryRaw`SELECT 1`;
  result.disabledStartup = true;

  const owner = await signup('owner');
  const control = await signup('control');
  stage = 'real-failed-run';
  const first = await createAgentAndFailedRun(owner, 'failed Run');
  const terminalType: NotificationType =
    first.run.status === 'TIMED_OUT' ? 'RUN_TIMED_OUT' : 'RUN_FAILED';
  const firstDelivery = await waitFor(() =>
    prisma.notificationDelivery.findFirst({
      where: {
        notification: { runId: first.run.id, type: terminalType },
        status: 'SENT',
      },
      include: { notification: true },
    })
  );
  assert(firstDelivery, 'Development-provider delivery did not become SENT.');
  result.realTerminalRunDelivered = true;

  stage = 'terminal-replay';
  await prisma.$transaction(async (transaction) => {
    for (let attempt = 0; attempt < 2; attempt += 1)
      await createRunTerminalNotification(transaction, {
        userId: owner.userId,
        runId: first.run.id,
        status: first.run.status as RunStatus,
        recordedAt: first.run.completedAt ?? new Date(),
      });
  });
  result.duplicateTerminalSuppressed =
    (await prisma.notification.count({
      where: { runId: first.run.id, type: terminalType },
    })) === 1 &&
    (await prisma.notificationDelivery.count({
      where: { notification: { runId: first.run.id, type: terminalType } },
    })) === 1;

  stage = 'schedule-block';
  await prisma.user.update({
    where: { id: owner.userId },
    data: { planCode: 'INTERNAL', planSource: 'INTERNAL' },
  });
  const due = new Date(Date.now() + 25_000);
  const scheduleResponse = await api(owner, '/api/schedules', 'POST', {
    agentId: first.agentId,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: due.toISOString(),
  });
  assert(
    scheduleResponse.status === 201,
    'Disposable schedule creation failed.'
  );
  const scheduleId = (scheduleResponse.payload as { data: { id: string } }).data
    .id;
  await prisma.user.update({
    where: { id: owner.userId },
    data: { planCode: 'FREE', planSource: 'DEFAULT' },
  });
  const blocked = await waitFor(() =>
    prisma.scheduledOccurrence.findFirst({
      where: { scheduleId, status: 'PLAN_BLOCKED' },
    })
  );
  assert(blocked, 'Scheduler did not create a real plan-blocked occurrence.');
  await emitScheduleAlert({
    scheduleId,
    occurrenceId: blocked.id,
    status: 'PLAN_BLOCKED',
    occurredAt: blocked.resolvedAt ?? new Date(),
  });
  const scheduleDelivery = await waitFor(() =>
    prisma.notificationDelivery.findFirst({
      where: {
        notification: { scheduleId, type: 'SCHEDULE_QUOTA_BLOCKED' },
        status: 'SENT',
      },
    })
  );
  result.scheduleBlockDeliveredOnce =
    Boolean(scheduleDelivery) &&
    (await prisma.notification.count({
      where: { scheduleId, type: 'SCHEDULE_QUOTA_BLOCKED' },
    })) === 1;

  stage = 'preference-disable';
  const preference = await api(
    owner,
    '/api/notifications/preferences',
    'PATCH',
    { runFailure: false }
  );
  assert(preference.status === 200, 'Preference update failed.');
  const second = await createAgentAndFailedRun(owner, 'preference disabled');
  const suppressed = await waitFor(() =>
    prisma.notificationDelivery.findFirst({
      where: {
        notification: { runId: second.run.id },
        status: 'SUPPRESSED',
        failureCode: 'PREFERENCE_DISABLED',
      },
    })
  );
  result.preferenceSuppressedDelivery = Boolean(suppressed);

  stage = 'isolation-redaction';
  const history = await api(owner, '/api/notifications?limit=100');
  const serialized = JSON.stringify(history.payload);
  const foreignRead = await api(
    control,
    `/api/notifications/${firstDelivery.notificationId}/read`,
    'POST'
  );
  const controlHistory = await api(control, '/api/notifications?limit=100');
  result.crossUserIsolation =
    foreignRead.status === 404 &&
    !JSON.stringify(controlHistory.payload).includes(
      firstDelivery.notificationId
    );
  result.redaction =
    history.status === 200 &&
    !serialized.includes('Open the unreachable') &&
    !/recipientEmail|providerMessageId|stripeSubscriptionId|failureMessage|apiKey/i.test(
      serialized
    );

  stage = 'account-deletion-provider-failure';
  const queue = getNotificationDeliveryQueue();
  await queue.pause();
  queuePaused = true;
  const deletionResponse = await api(owner, '/api/account/delete', 'POST', {
    confirmation: 'DELETE',
  });
  assert(deletionResponse.status === 202, 'Account deletion did not complete.');
  const deletion = await prisma.accountDeletion.findUniqueOrThrow({
    where: { userId: owner.userId },
  });
  const completionDelivery = await prisma.notificationDelivery.findFirstOrThrow(
    {
      where: {
        notification: {
          accountDeletionId: deletion.id,
          type: 'ACCOUNT_DELETION_COMPLETED',
        },
      },
    }
  );
  process.env.NOTIFICATION_QUEUE_ATTEMPTS = '1';
  const failingProvider = {
    send: async () => {
      throw new Error('intentional disposable provider failure');
    },
  };
  await new NotificationDeliveryProcessor(failingProvider)
    .process({
      data: { version: 1, deliveryId: completionDelivery.id },
    } as never)
    .catch(() => undefined);
  const failedDelivery = await prisma.notificationDelivery.findUniqueOrThrow({
    where: { id: completionDelivery.id },
  });
  result.deletionCompletedDespiteProviderFailure =
    deletion.status === 'COMPLETED' && failedDelivery.status === 'FAILED';
  await queue.resume();
  queuePaused = false;

  await api(control, '/api/account/delete', 'POST', { confirmation: 'DELETE' });
  const failed = Object.entries(result)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(failed.length === 0, `Runtime checks failed: ${failed.join(', ')}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ stage, error: error instanceof Error ? error.message : 'Unknown failure' })}\n`
  );
  process.exitCode = 1;
} finally {
  if (queuePaused)
    await getNotificationDeliveryQueue()
      .resume()
      .catch(() => undefined);
  await closeNotificationDeliveryQueue();
  await prisma.$disconnect();
}
