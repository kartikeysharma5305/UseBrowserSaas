import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { prisma } from '../src/lib/db/prisma';
import { getBrowserRunQueue } from '../src/lib/queue/browser-run-queue';

const execFileAsync = promisify(execFile);
const origin = 'http://localhost:3001';
const nonce = randomBytes(8).toString('hex');
const password = `Phase9-${nonce}-disposable!`;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
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

async function register(context: BrowserContext, label: string) {
  const page = await context.newPage();
  const email = `phase9-${label}-${nonce}@example.invalid`;
  await page.goto(`${origin}/register`, { waitUntil: 'load' });
  await page.waitForTimeout(750);
  await page.getByLabel('Full name').fill(`Phase 9 ${label}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, user, email };
}

async function assignInternal(email: string) {
  await execFileAsync(
    'pnpm.cmd',
    [
      'plans:assign',
      '--',
      `--email=${email}`,
      '--plan=INTERNAL',
      '--reason=Phase 9 disposable runtime',
      '--apply',
    ],
    { cwd: process.cwd(), windowsHide: true, shell: true }
  );
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

async function deleteAccount(page: Page) {
  await api(page, '/api/account/delete', 'POST', { confirmation: 'DELETE' });
}

const browser = await chromium.launch({ headless: true });
const ownerContext = await browser.newContext();
const controlContext = await browser.newContext();
const queue = getBrowserRunQueue();
let queuePaused = false;
let ownerPage: Page | null = null;
let controlPage: Page | null = null;
let stage = 'register';

const evidence = {
  definitionsPersisted: false,
  missingValuesBlocked: false,
  queuedSnapshotImmutable: false,
  workerUsedSnapshot: false,
  runApiSafeInputs: false,
  templateVariablesCreated: false,
  scheduledValuesPersisted: false,
  changedVariableBlockedSchedule: false,
  secretDeferredWithoutLeak: false,
  crossUserDenied: false,
  eventsAndNotificationsRedacted: false,
};

try {
  const owner = await register(ownerContext, 'owner');
  ownerPage = owner.page;
  await assignInternal(owner.email);
  const control = await register(controlContext, 'control');
  controlPage = control.page;

  stage = 'create-variable-agent';
  const definitions = [
    {
      key: 'website',
      label: 'Website',
      type: 'URL',
      required: true,
      constraints: {},
      displayOrder: 0,
    },
    {
      key: 'city',
      label: 'City',
      type: 'TEXT',
      required: true,
      constraints: { maxLength: 100 },
      displayOrder: 1,
    },
    {
      key: 'count',
      label: 'Result count',
      type: 'NUMBER',
      required: true,
      constraints: { min: 1, max: 10 },
      displayOrder: 2,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      type: 'BOOLEAN',
      required: true,
      defaultValue: 'true',
      constraints: {},
      displayOrder: 3,
    },
  ];
  const created = await api(owner.page, '/api/agents', 'POST', {
    name: 'Phase 9 reusable Agent',
    goal: 'Find {{count}} public items for {{city}} when enabled={{enabled}}.',
    targetWebsite: '{{website}}',
    status: 'ACTIVE',
    variables: definitions,
  });
  assert(created.status === 201, 'Variable Agent creation failed.');
  const agentId = (created.body as { data: { id: string } }).data.id;
  const storedAgent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { variables: true },
  });
  evidence.definitionsPersisted = storedAgent.variables.length === 4;

  stage = 'missing-values';
  const missing = await api(owner.page, `/api/agents/${agentId}/run`, 'POST', {
    variables: { website: 'https://example.com' },
  });
  evidence.missingValuesBlocked =
    missing.status === 400 &&
    (await prisma.run.count({ where: { agentId } })) === 0;

  stage = 'queued-snapshot';
  await queue.pause();
  queuePaused = true;
  const supplied = {
    website: 'https://example.com',
    city: 'Gurugram',
    count: 2,
    enabled: false,
  };
  const admitted = await api(owner.page, `/api/agents/${agentId}/run`, 'POST', {
    variables: supplied,
  });
  assert(admitted.status === 202, 'Resolved Run admission failed.');
  const runId = (admitted.body as { data: { runId: string } }).data.runId;
  const beforeEdit = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
  });
  assert(
    beforeEdit.status === 'QUEUED',
    'Paused queue did not preserve QUEUED state.'
  );
  const snapshotBefore = JSON.stringify(beforeEdit.inputSnapshot);
  const taskBefore = beforeEdit.executionTask;
  const edit = await api(owner.page, `/api/agents/${agentId}`, 'PATCH', {
    goal: 'EDITED after admission; do not use for the queued Run.',
  });
  assert(edit.status === 200, 'Agent edit after admission failed.');
  const afterEdit = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
  });
  evidence.queuedSnapshotImmutable =
    JSON.stringify(afterEdit.inputSnapshot) === snapshotBefore &&
    afterEdit.executionTask === taskBefore &&
    !afterEdit.executionTask?.includes('EDITED');
  await queue.resume();
  queuePaused = false;
  const terminal = await waitFor(() =>
    prisma.run.findFirst({
      where: {
        id: runId,
        status: { in: ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'] },
      },
      select: { status: true, attempt: true, executionTask: true },
    })
  );
  assert(terminal, 'Existing worker did not process the snapshotted Run.');
  evidence.workerUsedSnapshot =
    terminal.attempt >= 1 && terminal.executionTask === taskBefore;

  const runResponse = await api(owner.page, `/api/runs/${runId}`);
  const runJson = JSON.stringify(runResponse.body);
  evidence.runApiSafeInputs =
    runResponse.status === 200 &&
    runJson.includes('Gurugram') &&
    runJson.includes('definitionVersion') &&
    !runJson.includes('EDITED');

  stage = 'template';
  const template = await api(
    owner.page,
    '/api/templates/webpage-summarizer/create-agent',
    'POST',
    {
      name: 'Variable template Agent',
      goal: 'Summarize {{website}} and stop.',
      targetWebsite: 'https://example.com',
      createAndTest: false,
    }
  );
  assert(template.status === 201, 'Variable template Agent creation failed.');
  const templateAgentId = (template.body as { data: { agent: { id: string } } })
    .data.agent.id;
  evidence.templateVariablesCreated =
    (await prisma.agentVariable.count({
      where: { agentId: templateAgentId, key: 'website' },
    })) === 1;

  stage = 'schedule';
  const oneTimeAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const schedule = await api(owner.page, '/api/schedules', 'POST', {
    agentId,
    kind: 'ONCE',
    timezone: 'UTC',
    oneTimeAt,
    variables: supplied,
  });
  assert(schedule.status === 201, 'Schedule with variable values failed.');
  const scheduleId = (schedule.body as { data: { id: string } }).data.id;
  const storedSchedule = await prisma.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
  });
  evidence.scheduledValuesPersisted =
    JSON.stringify(storedSchedule.variableValues).includes('Gurugram') &&
    storedSchedule.variableVersion === storedAgent.variableVersion;

  await api(owner.page, `/api/agents/${agentId}`, 'PATCH', {
    goal: 'Find {{count}} public items when enabled={{enabled}}.',
  });
  const reducedDefinitions = definitions.filter(
    (definition) => definition.key !== 'city'
  );
  const variableEdit = await api(
    owner.page,
    `/api/agents/${agentId}/variables`,
    'PATCH',
    { variables: reducedDefinitions }
  );
  assert(variableEdit.status === 200, 'Variable definition edit failed.');
  const invalidated = await prisma.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
  });
  const blockedHistory = await prisma.scheduledOccurrence.findFirst({
    where: {
      scheduleId,
      status: 'AGENT_BLOCKED',
      errorCode: 'VARIABLE_CONFIGURATION_INVALID',
    },
  });
  evidence.changedVariableBlockedSchedule =
    invalidated.state === 'PAUSED' &&
    invalidated.configurationErrorCode === 'VARIABLE_CONFIGURATION_INVALID' &&
    Boolean(blockedHistory);

  stage = 'secret';
  const secretMarker = `runtime-secret-${nonce}`;
  const secretAgent = await api(owner.page, '/api/agents', 'POST', {
    name: 'Deferred secret Agent',
    goal: 'Use {{credential}} only when secure storage exists.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
    variables: [
      {
        key: 'credential',
        label: 'Credential',
        type: 'SECRET',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
    ],
  });
  assert(secretAgent.status === 201, 'Secret definition creation failed.');
  const secretAgentId = (secretAgent.body as { data: { id: string } }).data.id;
  const secretRun = await api(
    owner.page,
    `/api/agents/${secretAgentId}/run`,
    'POST',
    { variables: { credential: secretMarker } }
  );
  const secretResponse = JSON.stringify(secretRun.body);
  evidence.secretDeferredWithoutLeak =
    secretRun.status === 422 &&
    !secretResponse.includes(secretMarker) &&
    (await prisma.run.count({ where: { agentId: secretAgentId } })) === 0 &&
    (
      await prisma.agentVariable.findFirstOrThrow({
        where: { agentId: secretAgentId, key: 'credential' },
      })
    ).defaultValue === null;

  stage = 'isolation-redaction';
  const cross = await api(control.page, `/api/agents/${agentId}/variables`);
  evidence.crossUserDenied = cross.status === 404;
  const [events, notifications] = await Promise.all([
    prisma.agentEvent.findMany({ where: { runId } }),
    prisma.notification.findMany({ where: { userId: owner.user.id } }),
  ]);
  const operationalJson = JSON.stringify({ events, notifications });
  evidence.eventsAndNotificationsRedacted =
    !operationalJson.includes('Gurugram') &&
    !operationalJson.includes(secretMarker) &&
    !operationalJson.includes('https://example.com');

  const failed = Object.entries(evidence).filter(([, passed]) => !passed);
  assert(
    failed.length === 0,
    `Runtime checks failed: ${failed.map(([key]) => key).join(', ')}`
  );
  process.stdout.write(
    `${JSON.stringify({ ...evidence, terminalStatus: terminal.status })}\n`
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ stage, error: error instanceof Error ? error.message : 'Unknown failure' })}\n`
  );
  process.exitCode = 1;
} finally {
  if (queuePaused) await queue.resume().catch(() => undefined);
  if (ownerPage) await deleteAccount(ownerPage).catch(() => undefined);
  if (controlPage) await deleteAccount(controlPage).catch(() => undefined);
  await ownerContext.close();
  await controlContext.close();
  await browser.close();
  await queue.close();
  await prisma.$disconnect();
}
