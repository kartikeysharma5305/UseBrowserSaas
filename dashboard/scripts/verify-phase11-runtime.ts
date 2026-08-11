import { randomBytes } from 'node:crypto';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { prisma } from '../src/lib/db/prisma';
import { getBrowserRunQueue } from '../src/lib/queue/browser-run-queue';

const origin = 'http://localhost:3001';
const nonce = randomBytes(6).toString('hex');
const password = `Phase11-${nonce}-disposable!`;

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
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, method, body }
  ) as Promise<{ status: number; body: any }>;
}

async function register(context: BrowserContext, label: string) {
  const page = await context.newPage();
  const email = `phase11-${label}-${nonce}@example.invalid`;
  await page.goto(`${origin}/register`, { waitUntil: 'load' });
  await page.getByLabel('Full name').fill(`Phase 11 ${label}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, user };
}

async function waitForTerminal(runId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { status: true, lastFailureCode: true, errorMessage: true },
    });
    if (
      run &&
      ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].includes(run.status)
    )
      return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const ownerContext = await browser.newContext();
const controlContext = await browser.newContext();
const queue = getBrowserRunQueue();
let paused = false;
let ownerId: string | null = null;
let controlId: string | null = null;

const evidence = {
  authenticatedPolicyApi: false,
  crossUserDenied: false,
  immutableQueuedSnapshot: false,
  variableAllowlistBypassBlocked: false,
  privateNetworkBlockedBeforeBrowser: false,
  unsafeSchemeRejected: false,
  sanitizedFailure: false,
  disposableCleanup: false,
};

try {
  const owner = await register(ownerContext, 'owner');
  const control = await register(controlContext, 'control');
  ownerId = owner.user.id;
  controlId = control.user.id;

  const created = await api(owner.page, '/api/agents', 'POST', {
    name: 'Phase 11 public-only Agent',
    goal: 'Read the public example page.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
    safetyPolicy: {
      allowedDomains: ['example.com'],
      blockedDomains: [],
      allowSubdomains: false,
      redirectPolicy: 'SAME_DOMAIN',
      allowDownloads: false,
      allowUploads: false,
      formSubmissionMode: 'SAFE_ONLY',
      allowDestructiveActions: false,
      maxNavigations: 5,
      maxPages: 1,
      sensitiveDomainMode: 'BLOCK',
    },
  });
  assert(created.status === 201, 'Policy Agent creation failed.');
  const agentId = created.body.data.id as string;
  evidence.authenticatedPolicyApi =
    created.body.data.safetyPolicy.allowedDomains[0] === 'example.com';

  const denied = await api(control.page, `/api/agents/${agentId}`, 'PATCH', {
    safetyPolicy: { allowedDomains: ['attacker.test'] },
  });
  evidence.crossUserDenied = denied.status === 404;

  await queue.pause();
  paused = true;
  const admitted = await api(
    owner.page,
    `/api/agents/${agentId}/run`,
    'POST',
    {}
  );
  assert(admitted.status === 202, 'Run admission failed.');
  const runId = admitted.body.data.runId as string;
  const before = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const policyEdit = await api(owner.page, `/api/agents/${agentId}`, 'PATCH', {
    safetyPolicy: {
      ...created.body.data.safetyPolicy,
      allowSubdomains: true,
    },
  });
  const after = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const editedAgent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { safetyPolicy: true },
  });
  assert(policyEdit.status === 200, 'Subdomain policy edit failed.');
  const snapshotUnchanged =
    JSON.stringify(before.executionSafetyPolicy) ===
    JSON.stringify(after.executionSafetyPolicy);
  const queuedAllowsSubdomains = (
    after.executionSafetyPolicy as { allowSubdomains?: boolean }
  ).allowSubdomains;
  const editedAllowsSubdomains = (
    editedAgent.safetyPolicy as { allowSubdomains?: boolean }
  ).allowSubdomains;
  evidence.immutableQueuedSnapshot =
    snapshotUnchanged &&
    JSON.stringify(after.executionSafetyPolicy).includes('example.com') &&
    queuedAllowsSubdomains === false &&
    editedAgent.safetyPolicy !== null &&
    editedAllowsSubdomains === true;
  await api(owner.page, `/api/runs/${runId}/cancel`, 'POST', {
    reason: 'Disposable Phase 11 snapshot drill.',
  });
  await queue.resume();
  paused = false;

  const variableAgent = await api(owner.page, '/api/agents', 'POST', {
    name: 'Phase 11 URL variable Agent',
    goal: 'Read the configured page.',
    targetWebsite: '{{website}}',
    status: 'ACTIVE',
    variables: [
      {
        key: 'website',
        label: 'Website',
        type: 'URL',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
    ],
    safetyPolicy: { allowedDomains: ['example.com'] },
  });
  assert(variableAgent.status === 201, 'Variable Agent creation failed.');
  const bypass = await api(
    owner.page,
    `/api/agents/${variableAgent.body.data.id}/run`,
    'POST',
    { variables: { website: 'https://example.org' } }
  );
  evidence.variableAllowlistBypassBlocked = bypass.status === 400;

  const unsafeScheme = await api(owner.page, '/api/agents', 'POST', {
    name: 'Unsafe scheme',
    goal: 'No-op.',
    targetWebsite: 'file:///etc/passwd',
    status: 'ACTIVE',
  });
  evidence.unsafeSchemeRejected = unsafeScheme.status === 400;

  const privateAgent = await api(owner.page, '/api/agents', 'POST', {
    name: 'Private network guard',
    goal: 'No-op.',
    targetWebsite: 'http://127.0.0.1',
    status: 'ACTIVE',
    safetyPolicy: { allowedDomains: ['127.0.0.1'] },
  });
  assert(
    privateAgent.status === 201,
    'Private-network drill Agent creation failed.'
  );
  const privateRun = await api(
    owner.page,
    `/api/agents/${privateAgent.body.data.id}/run`,
    'POST',
    {}
  );
  assert(privateRun.status === 202, 'Private-network drill was not admitted.');
  const terminal = await waitForTerminal(privateRun.body.data.runId);
  assert(terminal, 'Private-network drill did not reach a terminal state.');
  evidence.privateNetworkBlockedBeforeBrowser =
    terminal.lastFailureCode === 'PRIVATE_NETWORK_BLOCKED';
  evidence.sanitizedFailure =
    terminal.errorMessage === 'Navigation blocked by network safety policy.' &&
    !JSON.stringify(terminal).includes('127.0.0.1');
} finally {
  if (paused) await queue.resume().catch(() => undefined);
  await queue.close().catch(() => undefined);
  await ownerContext.close().catch(() => undefined);
  await controlContext.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  if (ownerId || controlId) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, controlId].filter((id): id is string => Boolean(id)),
        },
      },
    });
    evidence.disposableCleanup =
      (await prisma.user.count({
        where: {
          id: {
            in: [ownerId, controlId].filter((id): id is string => Boolean(id)),
          },
        },
      })) === 0;
  }
  await prisma.$disconnect();
}

assert(
  Object.values(evidence).every(Boolean),
  `Phase 11 runtime evidence incomplete: ${JSON.stringify(evidence)}`
);
console.log(JSON.stringify({ phase: '11', status: 'passed', evidence }));
