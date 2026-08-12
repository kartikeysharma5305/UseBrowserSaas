import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { prisma } from '../src/lib/db/prisma';
import { registerRuntimeUser } from './runtime-beta-registration';

const execFileAsync = promisify(execFile);
const origin = 'http://localhost:3001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function register(
  context: BrowserContext,
  name: string,
  planCode: 'FREE' | 'PRO' = 'PRO'
) {
  const token = randomBytes(8).toString('hex');
  const email = `phase6d-${token}@example.invalid`;
  const password = `Runtime-${randomBytes(12).toString('hex')}!`;
  const page = await registerRuntimeUser({
    context,
    origin,
    email,
    name,
    password,
    planCode,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, email, userId: user.id };
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
      '--reason=Phase 6D disposable UI runtime',
      '--apply',
    ],
    { cwd: process.cwd(), windowsHide: true, shell: true }
  );
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

function scheduleCard(page: Page, summary: string) {
  return page
    .getByText(summary, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
}

async function openCreate(page: Page, agentId: string) {
  await page.getByRole('button', { name: 'Create schedule' }).first().click();
  const form = page.getByRole('region', { name: 'Create schedule' });
  await form.getByLabel('Agent').selectOption(agentId);
  await form.getByLabel('Timezone').selectOption('UTC');
  return form;
}

async function saveCreate(page: Page) {
  const form = page.getByRole('region', { name: 'Create schedule' });
  await form
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  await form.waitFor({ state: 'detached' });
  await page.getByText('Schedule created.', { exact: true }).waitFor();
}

const result = {
  freeRestrictionRendered: false,
  internalLimitRendered: false,
  oneTimeCreatedThroughUi: false,
  dailyCreatedThroughUi: false,
  weeklyCreatedThroughUi: false,
  editAppliedThroughUi: false,
  pauseResumeAppliedThroughUi: false,
  skipNextAppliedThroughUi: false,
  runNowPreservedNextOccurrence: false,
  occurrenceLinkedToRunDetail: false,
  deletePreservedRun: false,
  agentDetailIntegrated: false,
  mobileNavigationAndLayoutVerified: false,
  scheduleResponsesRedacted: false,
  crossUserReadAndMutationBlocked: false,
};

const browser = await chromium.launch({ headless: true });
const freeContext = await browser.newContext();
const internalContext = await browser.newContext();
let stage = 'registration';

try {
  const free = await register(freeContext, 'Phase 6D Free Control', 'FREE');
  const internal = await register(internalContext, 'Phase 6D UI Runtime');

  stage = 'free-plan';
  const freeAgent = await api(free.page, '/api/agents', 'POST', {
    name: 'Free UI control Agent',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  assert(freeAgent.status === 201, 'FREE Agent creation failed.');
  await free.page.goto(`${origin}/dashboard/schedules`, {
    waitUntil: 'networkidle',
  });
  const freeCreate = free.page.getByRole('button', { name: 'Create schedule' });
  result.freeRestrictionRendered =
    (await free.page
      .getByText('Scheduling is unavailable on FREE', { exact: false })
      .isVisible()) &&
    (await free.page
      .getByRole('link', { name: 'Upgrade to PRO' })
      .isVisible()) &&
    (await freeCreate.isDisabled());

  stage = 'trusted-plan';
  await assignInternal(internal.email);
  const agentResponse = await api(internal.page, '/api/agents', 'POST', {
    name: 'Phase 6D scheduled Agent',
    goal: 'Read the page title and finish.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
  });
  assert(agentResponse.status === 201, 'INTERNAL Agent creation failed.');
  const agentId = agentResponse.body.data.id as string;
  await internal.page.goto(`${origin}/dashboard/schedules`, {
    waitUntil: 'networkidle',
  });
  result.internalLimitRendered = await internal.page
    .getByText(/0 of 100 active schedules used/)
    .isVisible();

  stage = 'one-time-create';
  let due = new Date(Date.now() + 10 * 60_000);
  due.setUTCSeconds(0, 0);
  let dueDate = due.toISOString().slice(0, 10);
  let dueTime = due.toISOString().slice(11, 16);
  let form = await openCreate(internal.page, agentId);
  await form.getByLabel('One time').check();
  await form.getByLabel('Future date').fill(dueDate);
  await form.getByLabel('Local time').fill(dueTime);
  await saveCreate(internal.page);
  const oneTime = await prisma.schedule.findFirstOrThrow({
    where: { userId: internal.userId, agentId, kind: 'ONCE' },
    orderBy: { createdAt: 'desc' },
  });
  result.oneTimeCreatedThroughUi = oneTime.timezone === 'UTC';

  stage = 'daily-create';
  form = await openCreate(internal.page, agentId);
  await form.getByLabel('Daily').check();
  await form.getByLabel('Local time').fill('20:15');
  await saveCreate(internal.page);
  const daily = await prisma.schedule.findFirstOrThrow({
    where: { userId: internal.userId, agentId, kind: 'DAILY' },
    orderBy: { createdAt: 'desc' },
  });
  result.dailyCreatedThroughUi = daily.localTime === '20:15';

  stage = 'weekly-create';
  form = await openCreate(internal.page, agentId);
  await form.getByLabel('Weekly').check();
  await form.getByLabel('Local time').fill('19:45');
  await form.getByText('Mon', { exact: true }).click();
  await form.getByText('Fri', { exact: true }).click();
  await saveCreate(internal.page);
  const weekly = await prisma.schedule.findFirstOrThrow({
    where: { userId: internal.userId, agentId, kind: 'WEEKLY' },
    orderBy: { createdAt: 'desc' },
  });
  result.weeklyCreatedThroughUi = weekly.weekdays.join(',') === '1,5';

  stage = 'edit';
  await scheduleCard(internal.page, 'Daily at 20:15')
    .getByRole('button', { name: 'Edit' })
    .click();
  form = internal.page.getByRole('region', { name: 'Edit schedule' });
  await form.getByLabel('Local time').fill('21:15');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await form.waitFor({ state: 'detached' });
  await internal.page.getByText('Schedule updated.', { exact: true }).waitFor();
  result.editAppliedThroughUi =
    (await prisma.schedule.findUniqueOrThrow({ where: { id: daily.id } }))
      .localTime === '21:15';

  stage = 'pause-resume';
  internal.page.once('dialog', (dialog) => dialog.accept());
  await scheduleCard(internal.page, 'Daily at 21:15')
    .getByRole('button', { name: 'Pause' })
    .click();
  await internal.page.getByText('Schedule pause completed.').waitFor();
  const paused = await prisma.schedule.findUniqueOrThrow({
    where: { id: daily.id },
  });
  await scheduleCard(internal.page, 'Daily at 21:15')
    .getByRole('button', { name: 'Resume' })
    .click();
  await internal.page.getByText('Schedule resume completed.').waitFor();
  const resumed = await prisma.schedule.findUniqueOrThrow({
    where: { id: daily.id },
  });
  result.pauseResumeAppliedThroughUi =
    paused.state === 'PAUSED' &&
    resumed.state === 'ENABLED' &&
    resumed.nextRunAt !== null;

  stage = 'skip-next';
  const beforeSkip = weekly.nextRunAt;
  internal.page.once('dialog', (dialog) => dialog.accept());
  await scheduleCard(internal.page, 'Mon, Fri at 19:45')
    .getByRole('button', { name: 'Skip next' })
    .click();
  await internal.page.getByText('Schedule skip next completed.').waitFor();
  const afterSkip = await prisma.schedule.findUniqueOrThrow({
    where: { id: weekly.id },
  });
  const skipped = await prisma.scheduledOccurrence.findUnique({
    where: {
      scheduleId_scheduledFor: {
        scheduleId: weekly.id,
        scheduledFor: beforeSkip!,
      },
    },
  });
  result.skipNextAppliedThroughUi =
    skipped?.status === 'SKIPPED' &&
    Boolean(
      afterSkip.nextRunAt && beforeSkip && afterSkip.nextRunAt > beforeSkip
    );

  stage = 'run-now';
  const beforeRunNow = afterSkip.nextRunAt?.getTime();
  await scheduleCard(internal.page, 'Mon, Fri at 19:45')
    .getByRole('button', { name: 'Run now' })
    .click();
  await internal.page
    .getByText('Run admitted without changing the next scheduled occurrence.', {
      exact: false,
    })
    .waitFor();
  const afterRunNow = await prisma.schedule.findUniqueOrThrow({
    where: { id: weekly.id },
  });
  result.runNowPreservedNextOccurrence =
    beforeRunNow === afterRunNow.nextRunAt?.getTime();
  const terminalRun = await waitFor(() =>
    prisma.run.findFirst({
      where: {
        agentId,
        status: { in: ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'] },
      },
      orderBy: { createdAt: 'desc' },
    })
  );
  assert(terminalRun, 'Run now did not reach a terminal worker state.');

  stage = 'one-time-near-future-edit';
  const initialOneTimeSummary = `Once on ${dueDate} ${dueTime}`;
  await scheduleCard(internal.page, initialOneTimeSummary)
    .getByRole('button', { name: 'Edit' })
    .click();
  form = internal.page.getByRole('region', { name: 'Edit schedule' });
  due = new Date(Date.now() + 90_000);
  due.setUTCSeconds(0, 0);
  dueDate = due.toISOString().slice(0, 10);
  dueTime = due.toISOString().slice(11, 16);
  await form.getByLabel('Future date').fill(dueDate);
  await form.getByLabel('Local time').fill(dueTime);
  await form.getByRole('button', { name: 'Save changes' }).click();
  await form.waitFor({ state: 'detached' });

  stage = 'occurrence-link';
  const occurrence = await waitFor(() =>
    prisma.scheduledOccurrence.findFirst({
      where: {
        scheduleId: oneTime.id,
        status: 'ADMITTED',
        runId: { not: null },
      },
    })
  );
  assert(occurrence?.runId, 'One-time occurrence was not admitted.');
  await internal.page.reload({ waitUntil: 'networkidle' });
  const oneTimeSummary = `Once on ${dueDate} ${dueTime}`;
  const oneTimeCard = scheduleCard(internal.page, oneTimeSummary);
  await oneTimeCard.getByRole('button', { name: 'View history' }).click();
  const runLink = oneTimeCard.getByRole('link', { name: 'View Run' });
  const href = await runLink.getAttribute('href');
  result.occurrenceLinkedToRunDetail =
    href === `/dashboard/runs/${occurrence.runId}`;
  await runLink.click();
  await internal.page.waitForURL(
    new RegExp(`/dashboard/runs/${occurrence.runId}$`)
  );

  stage = 'agent-integration';
  await internal.page.goto(`${origin}/dashboard/agents/${agentId}`, {
    waitUntil: 'networkidle',
  });
  result.agentDetailIntegrated =
    (await internal.page
      .getByRole('heading', { name: 'Schedules' })
      .isVisible()) &&
    (await internal.page
      .getByText('Daily at 21:15', { exact: true })
      .isVisible());

  stage = 'mobile-layout';
  await internal.page.setViewportSize({ width: 390, height: 844 });
  await internal.page.goto(`${origin}/dashboard/schedules`, {
    waitUntil: 'networkidle',
  });
  const dimensions = await internal.page.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  await internal.page
    .getByRole('button', { name: 'Open navigation menu' })
    .click();
  const mobileScheduling = await internal.page
    .getByRole('link', { name: 'Scheduling' })
    .isVisible();
  result.mobileNavigationAndLayoutVerified =
    mobileScheduling && dimensions.width <= dimensions.viewport + 1;

  stage = 'redaction-and-isolation';
  const listResponse = await api(internal.page, '/api/schedules');
  const serialized = JSON.stringify(listResponse.body);
  result.scheduleResponsesRedacted =
    listResponse.status === 200 &&
    !/"(?:goal|targetWebsite|configuration|userId|consecutiveFailures|stack)"\s*:/i.test(
      serialized
    ) &&
    !/prisma/i.test(serialized);
  const crossRead = await api(free.page, `/api/schedules/${weekly.id}`);
  const crossPatch = await api(
    free.page,
    `/api/schedules/${weekly.id}`,
    'PATCH',
    {
      version: afterRunNow.version,
      localTime: '00:01',
    }
  );
  const isolated = await prisma.schedule.findUniqueOrThrow({
    where: { id: weekly.id },
  });
  result.crossUserReadAndMutationBlocked =
    crossRead.status === 404 &&
    crossPatch.status === 404 &&
    isolated.localTime === '19:45';

  stage = 'delete';
  await internal.page.setViewportSize({ width: 1280, height: 900 });
  await internal.page.goto(`${origin}/dashboard/schedules`, {
    waitUntil: 'networkidle',
  });
  internal.page.once('dialog', (dialog) => dialog.accept());
  await scheduleCard(internal.page, oneTimeSummary)
    .getByRole('button', { name: 'Delete' })
    .click();
  await internal.page.getByText('Schedule delete completed.').waitFor();
  result.deletePreservedRun =
    (await prisma.schedule.findUnique({ where: { id: oneTime.id } })) ===
      null &&
    (await prisma.run.findUnique({ where: { id: occurrence.runId } })) !== null;

  const failedChecks = Object.entries(result)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failedChecks.length === 0,
    `UI runtime checks failed: ${failedChecks.join(', ')}`
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ stage, error: error instanceof Error ? error.message : 'Unknown failure' })}\n`
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'phase6d-', endsWith: '@example.invalid' } },
  });
  await prisma.$disconnect();
}
