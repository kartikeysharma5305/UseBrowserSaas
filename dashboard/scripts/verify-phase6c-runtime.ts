import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { prisma } from '../src/lib/db/prisma';

const execFileAsync = promisify(execFile);
const origin = 'http://localhost:3001';

async function register(context: BrowserContext, label: string) {
  const page = await context.newPage();
  const token = randomBytes(8).toString('hex');
  const email = `phase6c-${token}@example.invalid`;
  const password = `Runtime-${randomBytes(12).toString('hex')}!`;
  await page.goto(`${origin}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill(label);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\/)?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, email, user };
}

async function api(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch(url, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body }
  );
}

async function assignInternal(email: string) {
  await execFileAsync(
    'pnpm.cmd',
    [
      'plans:assign',
      '--',
      `--email=${email}`,
      '--plan=INTERNAL',
      '--reason=Phase 6C disposable runtime',
      '--apply',
    ],
    { cwd: process.cwd(), windowsHide: true, shell: true }
  );
}

function startScheduler() {
  return spawn(
    process.execPath,
    [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      '--env-file=.env',
      '--env-file=.env.local',
      'src/worker/schedule-worker.ts',
    ],
    { cwd: process.cwd(), stdio: 'ignore', windowsHide: true }
  );
}

async function stopScheduler(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

const result = {
  usersRegisteredThroughApplication: false,
  freeScheduleRejected: false,
  internalPlanAssignedByMaintenanceCommand: false,
  oneTimeScheduleCreatedThroughApi: false,
  concurrentSchedulersSingleOccurrence: false,
  concurrentSchedulersSingleRun: false,
  existingQueueAndWorkerExecutedRun: false,
  downtimeProducedNoEarlyOccurrence: false,
  schedulerRestartRecoveredOccurrence: false,
  recurringPausePreventedTrigger: false,
  recurringResumeRecomputedFuture: false,
  skipNextRecordedAndAdvanced: false,
  runNowUsedManualPathWithoutScheduleMutation: false,
  accountDeletionPreventedScheduledRun: false,
  agentDeletionPreventedScheduledRun: false,
  crossUserStateUnaffected: false,
};

const browser = await chromium.launch({ headless: true });
const targetContext = await browser.newContext();
const freeContext = await browser.newContext();
const deletionContext = await browser.newContext();
const schedulers: ChildProcess[] = [];
let failureStage = 'initialization';

try {
  failureStage = 'registration';
  const target = await register(targetContext, 'Phase 6C Runtime');
  const free = await register(freeContext, 'Phase 6C Free Control');
  const deleting = await register(deletionContext, 'Phase 6C Delete Control');
  result.usersRegisteredThroughApplication = true;

  const freeAgentResponse = await api(free.page, '/api/agents', 'POST', {
    name: 'Free scheduling control',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  const freeAttempt = await api(free.page, '/api/schedules', 'POST', {
    agentId: freeAgentResponse.body.data.id,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: new Date(Date.now() + 60_000).toISOString(),
  });
  result.freeScheduleRejected =
    freeAttempt.status === 403 &&
    freeAttempt.body.code === 'SCHEDULING_NOT_AVAILABLE';

  failureStage = 'trusted-plan-assignment';
  await assignInternal(target.email);
  await assignInternal(deleting.email);
  result.internalPlanAssignedByMaintenanceCommand = true;

  const agentResponse = await api(target.page, '/api/agents', 'POST', {
    name: 'Scheduled runtime agent',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  const agentId = agentResponse.body.data.id as string;

  failureStage = 'concurrent-one-time';
  const firstDue = new Date(Date.now() + 18_000);
  const firstSchedule = await api(target.page, '/api/schedules', 'POST', {
    agentId,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: firstDue.toISOString(),
  });
  const firstScheduleId = firstSchedule.body.data.id as string;
  result.oneTimeScheduleCreatedThroughApi = firstSchedule.status === 201;
  const schedulerOne = startScheduler();
  const schedulerTwo = startScheduler();
  schedulers.push(schedulerOne, schedulerTwo);
  const firstOccurrence = await waitFor(() =>
    prisma.scheduledOccurrence.findFirst({
      where: { scheduleId: firstScheduleId, status: 'ADMITTED' },
    })
  );
  const firstRun = firstOccurrence?.runId
    ? await waitFor(() =>
        prisma.run.findUnique({ where: { id: firstOccurrence.runId! } })
      )
    : null;
  result.concurrentSchedulersSingleOccurrence =
    Boolean(firstOccurrence) &&
    (await prisma.scheduledOccurrence.count({
      where: { scheduleId: firstScheduleId, scheduledFor: firstDue },
    })) === 1;
  result.concurrentSchedulersSingleRun =
    Boolean(firstRun) &&
    (await prisma.run.count({
      where: { id: firstOccurrence?.runId ?? '' },
    })) === 1;
  const executed = firstRun
    ? await waitFor(
        () =>
          prisma.run.findFirst({
            where: {
              id: firstRun.id,
              status: { in: ['RUNNING', 'SUCCESS', 'FAILED', 'TIMED_OUT'] },
            },
          }),
        120_000
      )
    : null;
  result.existingQueueAndWorkerExecutedRun = Boolean(executed);
  await Promise.all([stopScheduler(schedulerOne), stopScheduler(schedulerTwo)]);

  failureStage = 'restart-recovery';
  const recoveryAgent = await api(target.page, '/api/agents', 'POST', {
    name: 'Restart recovery agent',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  const recoveryDue = new Date(Date.now() + 12_000);
  const recoverySchedule = await api(target.page, '/api/schedules', 'POST', {
    agentId: recoveryAgent.body.data.id,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: recoveryDue.toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  result.downtimeProducedNoEarlyOccurrence =
    (await prisma.scheduledOccurrence.count({
      where: { scheduleId: recoverySchedule.body.data.id },
    })) === 0;
  const recoveryScheduler = startScheduler();
  schedulers.push(recoveryScheduler);
  result.schedulerRestartRecoveredOccurrence = Boolean(
    await waitFor(() =>
      prisma.scheduledOccurrence.findFirst({
        where: {
          scheduleId: recoverySchedule.body.data.id,
          status: 'ADMITTED',
        },
      })
    )
  );

  failureStage = 'pause-resume-skip';
  const minute = new Date(Date.now() + 70_000);
  const localTime = `${String(minute.getUTCHours()).padStart(2, '0')}:${String(
    minute.getUTCMinutes()
  ).padStart(2, '0')}`;
  const daily = await api(target.page, '/api/schedules', 'POST', {
    agentId,
    kind: 'DAILY',
    timezone: 'UTC',
    localTime,
  });
  const dailyId = daily.body.data.id as string;
  const pausedAt = new Date(daily.body.data.nextRunAt);
  await api(target.page, `/api/schedules/${dailyId}/pause`, 'POST');
  const pauseWait = Math.max(0, pausedAt.getTime() - Date.now() + 5_000);
  await new Promise((resolve) => setTimeout(resolve, pauseWait));
  result.recurringPausePreventedTrigger =
    (await prisma.scheduledOccurrence.count({
      where: { scheduleId: dailyId },
    })) === 0;
  const resumed = await api(
    target.page,
    `/api/schedules/${dailyId}/resume`,
    'POST'
  );
  const resumedAt = new Date(resumed.body.data.nextRunAt);
  result.recurringResumeRecomputedFuture =
    resumed.status === 200 &&
    resumedAt.getTime() > Date.now() + 20 * 60 * 60 * 1000;
  const skipped = await api(
    target.page,
    `/api/schedules/${dailyId}/skip-next`,
    'POST'
  );
  result.skipNextRecordedAndAdvanced =
    skipped.status === 200 &&
    new Date(skipped.body.data.nextRunAt) > resumedAt &&
    (await prisma.scheduledOccurrence.count({
      where: {
        scheduleId: dailyId,
        scheduledFor: resumedAt,
        status: 'SKIPPED',
      },
    })) === 1;

  const nextBeforeRunNow = skipped.body.data.nextRunAt;
  const runNow = await api(
    target.page,
    `/api/schedules/${dailyId}/run-now`,
    'POST'
  );
  const afterRunNow = await prisma.schedule.findUniqueOrThrow({
    where: { id: dailyId },
  });
  result.runNowUsedManualPathWithoutScheduleMutation =
    runNow.status === 202 &&
    afterRunNow.nextRunAt?.toISOString() ===
      new Date(nextBeforeRunNow).toISOString() &&
    (await prisma.run.count({
      where: { id: runNow.body.data.runId, scheduledOccurrence: null },
    })) === 1;

  failureStage = 'deletion-integration';
  const deletingAgent = await api(deleting.page, '/api/agents', 'POST', {
    name: 'Account deletion scheduling control',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  const deletingSchedule = await api(deleting.page, '/api/schedules', 'POST', {
    agentId: deletingAgent.body.data.id,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: new Date(Date.now() + 20_000).toISOString(),
  });
  const deletionResponse = await api(
    deleting.page,
    '/api/account/delete',
    'POST',
    {
      confirmation: 'DELETE',
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 25_000));
  result.accountDeletionPreventedScheduledRun =
    deletionResponse.status === 202 &&
    (await prisma.schedule.count({
      where: { id: deletingSchedule.body.data.id },
    })) === 0 &&
    (await prisma.run.count({
      where: { agentId: deletingAgent.body.data.id },
    })) === 0;

  const deletedAgent = await api(target.page, '/api/agents', 'POST', {
    name: 'Agent deletion scheduling control',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  const agentSchedule = await api(target.page, '/api/schedules', 'POST', {
    agentId: deletedAgent.body.data.id,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt: new Date(Date.now() + 15_000).toISOString(),
  });
  const agentDelete = await api(
    target.page,
    `/api/agents/${deletedAgent.body.data.id}`,
    'DELETE'
  );
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  result.agentDeletionPreventedScheduledRun =
    agentDelete.status === 200 &&
    (await prisma.schedule.count({
      where: { id: agentSchedule.body.data.id },
    })) === 0 &&
    (await prisma.run.count({
      where: { agentId: deletedAgent.body.data.id },
    })) === 0;
  result.crossUserStateUnaffected =
    Boolean(await prisma.user.findUnique({ where: { id: free.user.id } })) &&
    Boolean(
      await prisma.agent.findUnique({
        where: { id: freeAgentResponse.body.data.id },
      })
    ) &&
    Boolean(await prisma.schedule.findUnique({ where: { id: dailyId } }));

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
  await Promise.all(schedulers.map(stopScheduler));
  await Promise.all([
    targetContext.close(),
    freeContext.close(),
    deletionContext.close(),
  ]);
  await browser.close();
  await prisma.$disconnect();
}
