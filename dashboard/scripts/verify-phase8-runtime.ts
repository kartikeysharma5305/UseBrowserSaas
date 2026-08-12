import { randomBytes } from 'node:crypto';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

import { prisma } from '../src/lib/db/prisma';
import { registerRuntimeUser } from './runtime-beta-registration';

const origin = 'http://localhost:3001';
const nonce = randomBytes(8).toString('hex');

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function register(context: BrowserContext, label: string) {
  const email = `phase8-${label}-${nonce}@example.invalid`;
  const page = await registerRuntimeUser({
    context,
    origin,
    email,
    name: `Phase 8 ${label}`,
    password: `Phase8-${nonce}-disposable!`,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, userId: user.id };
}

async function api(
  page: Page,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<{ status: number; body: unknown }> {
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
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: 'Non-JSON response.' };
        }
      }
      return { status: response.status, body: parsed };
    },
    { path, method, body }
  ) as Promise<{ status: number; body: unknown }>;
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await read();
    if (item) return item;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

async function deleteAccount(page: Page) {
  return api(page, '/api/account/delete', 'POST', { confirmation: 'DELETE' });
}

async function cleanupAbandonedRuntimeUsers(browser: Browser) {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'phase8-' } },
    select: { email: true },
  });
  for (const user of users) {
    const match =
      /^phase8-(?:owner|control)-([a-f0-9]+)@example\.invalid$/.exec(
        user.email
      );
    if (!match) continue;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/login`, { waitUntil: 'load' });
      await page.waitForTimeout(750);
      await page.getByLabel('Email').fill(user.email);
      await page.getByLabel('Password').fill(`Phase8-${match[1]}-disposable!`);
      await Promise.all([
        page.waitForURL(/\/dashboard\/?$/, { timeout: 30_000 }),
        page.getByRole('button', { name: 'Sign in' }).click(),
      ]);
      await deleteAccount(page);
    } finally {
      await context.close();
    }
  }
}

const result = {
  newUserOnboardingVisible: false,
  catalogueFilterAndPreview: false,
  planAdjustmentVisible: false,
  ordinaryAgentCreated: false,
  createAndTestQueued: false,
  existingRunDetailOpened: false,
  authoritativeAgentAndRunMilestones: false,
  successfulRunMilestone: false,
  failedRunRecoveryRedacted: false,
  dismissPersisted: false,
  reopenPersisted: false,
  existingUserNotForced: false,
  mobileNavigationAndLayout: false,
  crossUserIsolation: false,
  apiRedaction: false,
};

const browser = await chromium.launch({ headless: true });
await cleanupAbandonedRuntimeUsers(browser);
const ownerContext = await browser.newContext();
const controlContext = await browser.newContext();
let stage = 'register';
let ownerPage: Page | null = null;
let controlPage: Page | null = null;

try {
  const owner = await register(ownerContext, 'owner');
  ownerPage = owner.page;
  stage = 'new-user-onboarding';
  await owner.page.getByText('First-run checklist', { exact: false }).waitFor();
  result.newUserOnboardingVisible = await owner.page
    .getByRole('link', { name: 'Browse templates' })
    .isVisible();

  stage = 'catalogue';
  await owner.page.getByRole('link', { name: 'Browse templates' }).click();
  await owner.page.waitForURL(/\/dashboard\/templates$/);
  const catalogueResponse = await api(owner.page, '/api/templates');
  assert(
    catalogueResponse.status === 200,
    `Template catalogue API returned ${catalogueResponse.status}.`
  );
  await owner.page
    .getByRole('button', { name: /monitoring/i })
    .waitFor({ timeout: 30_000 });
  await owner.page.getByRole('button', { name: /monitoring/i }).click();
  const card = owner.page
    .getByRole('heading', { name: 'Competitor page monitor' })
    .locator('xpath=ancestor::div[contains(@class,"p-5")][1]');
  await card.getByRole('button', { name: 'Preview' }).click();
  result.catalogueFilterAndPreview =
    (await owner.page
      .getByRole('region', { name: 'Template preview' })
      .isVisible()) &&
    (await owner.page
      .getByText('Expected result', { exact: true })
      .isVisible());
  await card.getByRole('button', { name: 'Use template' }).click();
  await owner.page.waitForURL(
    /\/dashboard\/agents\/create\?template=competitor-page-monitor$/
  );
  await owner.page.getByLabel('Target website').fill('https://example.com');
  result.planAdjustmentVisible = await owner.page
    .getByText('adjusted to your current plan', { exact: false })
    .isVisible();

  stage = 'create-and-test';
  await owner.page.getByRole('button', { name: 'Create and test' }).click();
  await owner.page.waitForURL(/\/dashboard\/runs\//, { timeout: 45_000 });
  const firstRunId = owner.page.url().split('/').at(-1)!;
  const firstRun = await waitFor(() =>
    prisma.run.findUnique({
      where: { id: firstRunId },
      include: { agent: true },
    })
  );
  assert(firstRun, 'Create and test did not create an ordinary Run.');
  result.ordinaryAgentCreated =
    firstRun.agent.userId === owner.userId &&
    firstRun.agent.scheduleType === 'MANUAL';
  result.createAndTestQueued = Boolean(
    firstRun.queueJobId && firstRun.queuedAt
  );
  await owner.page
    .getByRole('heading', { name: firstRun.agent.name, exact: true })
    .waitFor({ timeout: 30_000 });
  result.existingRunDetailOpened = true;

  const terminal = await waitFor(() =>
    prisma.run.findFirst({
      where: {
        id: firstRunId,
        status: { in: ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'] },
      },
      select: { status: true },
    })
  );
  assert(terminal, 'First template Run did not reach a terminal state.');

  stage = 'checklist';
  const onboarding = await api(owner.page, '/api/onboarding');
  const checklist = (
    onboarding.body as {
      data: {
        checklist: {
          firstAgentCreatedAt?: string | null;
          firstRunStartedAt?: string | null;
          firstSuccessfulRunAt?: string | null;
        };
      };
    }
  ).data.checklist;
  result.authoritativeAgentAndRunMilestones =
    Boolean(checklist.firstAgentCreatedAt) &&
    Boolean(checklist.firstRunStartedAt);
  result.successfulRunMilestone =
    terminal.status === 'SUCCESS' && Boolean(checklist.firstSuccessfulRunAt);

  stage = 'failed-run';
  const failedCreate = await api(
    owner.page,
    '/api/templates/website-content-checker/create-agent',
    'POST',
    {
      name: 'Disposable failure guidance',
      goal: 'Check for the phrase and stop safely.',
      targetWebsite: 'http://127.0.0.1:1',
      createAndTest: true,
    }
  );
  assert(
    failedCreate.status === 201,
    'Failed-Run Agent creation was rejected.'
  );
  const failedRunId = (
    failedCreate.body as { data: { run?: { runId?: string } | null } }
  ).data.run?.runId;
  assert(failedRunId, 'Failed-Run admission did not use the queue.');
  const failedRun = await waitFor(() =>
    prisma.run.findFirst({
      where: { id: failedRunId, status: { in: ['FAILED', 'TIMED_OUT'] } },
      select: { status: true },
    })
  );
  assert(failedRun, 'Disposable failure Run did not fail safely.');
  await owner.page.goto(`${origin}/dashboard/runs/${failedRunId}`, {
    waitUntil: 'domcontentloaded',
  });
  await owner.page.waitForFunction(
    () => /failed|timed out/i.test(document.body.innerText),
    undefined,
    { timeout: 30_000 }
  );
  const failedBody = await owner.page.locator('body').innerText();
  result.failedRunRecoveryRedacted =
    /failed|timed out/i.test(failedBody) &&
    !/Prisma|stack trace|api[_ -]?key|GroqError|127\.0\.0\.1:1/i.test(
      failedBody
    );

  stage = 'dismiss-reopen';
  await api(owner.page, '/api/onboarding', 'PATCH', { action: 'REOPEN' });
  await owner.page.goto(`${origin}/dashboard`, {
    waitUntil: 'domcontentloaded',
  });
  await owner.page.getByRole('button', { name: 'Skip for now' }).click();
  await owner.page.reload({ waitUntil: 'domcontentloaded' });
  result.dismissPersisted = !(await owner.page
    .getByText('First-run checklist', { exact: false })
    .isVisible());
  await owner.page.goto(`${origin}/dashboard/settings`, {
    waitUntil: 'domcontentloaded',
  });
  await owner.page.waitForTimeout(750);
  await owner.page.getByRole('button', { name: 'Reopen onboarding' }).click();
  await owner.page
    .getByText('Onboarding reopened on your dashboard.')
    .waitFor();
  await owner.page.goto(`${origin}/dashboard`, {
    waitUntil: 'domcontentloaded',
  });
  await owner.page
    .getByText('First-run checklist', { exact: false })
    .waitFor({ timeout: 30_000 });
  result.reopenPersisted = true;

  stage = 'existing-control-user';
  const control = await register(controlContext, 'control');
  controlPage = control.page;
  const controlAgent = await api(control.page, '/api/agents', 'POST', {
    name: 'Existing user Agent',
    goal: 'Read the page title and stop.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
    scheduleType: 'MANUAL',
    scheduleConfig: {},
  });
  assert(controlAgent.status === 201, 'Control Agent creation failed.');
  await prisma.onboardingState.deleteMany({
    where: { userId: control.userId },
  });
  await control.page.reload({ waitUntil: 'domcontentloaded' });
  result.existingUserNotForced = !(await control.page
    .getByText('First-run checklist', { exact: false })
    .isVisible());

  stage = 'mobile-and-isolation';
  await owner.page.setViewportSize({ width: 390, height: 844 });
  await owner.page.goto(`${origin}/dashboard/templates`, {
    waitUntil: 'domcontentloaded',
  });
  await owner.page.waitForTimeout(750);
  const dimensions = await owner.page.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  await owner.page
    .getByRole('button', { name: 'Open navigation menu' })
    .click();
  result.mobileNavigationAndLayout =
    (await owner.page.getByRole('link', { name: 'Templates' }).isVisible()) &&
    dimensions.width <= dimensions.viewport + 1;
  const crossRead = await api(control.page, `/api/agents/${firstRun.agentId}`);
  result.crossUserIsolation = crossRead.status === 404;

  const templatesResponse = await api(owner.page, '/api/templates');
  const templateJson = JSON.stringify(templatesResponse.body);
  result.apiRedaction =
    templatesResponse.status === 200 &&
    !/configuration|browserSettings|apiKey|userId|stripe|stack|groq_llama/i.test(
      templateJson
    );

  const required = Object.entries(result).filter(
    ([key, passed]) => key !== 'successfulRunMilestone' && !passed
  );
  assert(
    required.length === 0,
    `Runtime checks failed: ${required.map(([key]) => key).join(', ')}`
  );
  process.stdout.write(
    `${JSON.stringify({ ...result, firstRunTerminalStatus: terminal.status, failedRunTerminalStatus: failedRun.status })}\n`
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ stage, error: error instanceof Error ? error.message : 'Unknown failure' })}\n`
  );
  process.exitCode = 1;
} finally {
  if (ownerPage) await deleteAccount(ownerPage).catch(() => undefined);
  if (controlPage) await deleteAccount(controlPage).catch(() => undefined);
  await browser.close();
  await prisma.$disconnect();
}
