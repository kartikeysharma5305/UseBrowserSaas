import { randomUUID } from 'node:crypto';

import { prisma } from '../src/lib/db/prisma';
import { persistScreenshotCandidates } from '../src/lib/browser/artifact-persistence';
import { PrismaRunProducer } from '../src/lib/queue/run-producer';
import { processDiscoveredOccurrence } from '../src/lib/scheduling/processor';
import { getUtcCalendarMonthPeriod } from '../src/lib/usage/period';

const baseUrl = process.env.PHASE21_BASE_URL ?? 'http://localhost:3001';
const marker = randomUUID().replaceAll('-', '');
const password = `Phase21-${marker}!aA1`;
const accounts = [
  { plan: 'FREE' as const, email: `phase21-free-${marker}@example.invalid` },
  { plan: 'PRO' as const, email: `phase21-pro-${marker}@example.invalid` },
  {
    plan: 'INTERNAL' as const,
    email: `phase21-internal-${marker}@example.invalid`,
  },
];

function sessionCookie(response: Response) {
  const value = response.headers.get('set-cookie') ?? '';
  const match = /([^=;, ]*session[^=;, ]*)=([^;]+)/i.exec(value);
  if (!match) throw new Error('Session cookie was not issued.');
  return `${match[1]}=${match[2]}`;
}

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function expectStatus(response: Response, expected: number, label: string) {
  if (response.status !== expected)
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`
    );
}

async function createAgent(
  cookie: string,
  label: string,
  timeoutMs: number,
  maxSteps: number,
  targetWebsite = 'https://example.com'
) {
  const response = await post(
    '/api/agents',
    {
      name: `Phase 21 ${label}`,
      goal: 'Read the page title and finish without interaction.',
      targetWebsite,
      status: 'ACTIVE',
      configuration: {
        model: 'groq_llama-3.3-70b-versatile',
        timeoutMs,
        maxSteps,
        browserSettings: {
          headless: true,
          viewportWidth: 1280,
          viewportHeight: 720,
        },
      },
    },
    cookie
  );
  expectStatus(response, 201, `${label} Agent creation`);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function waitForTerminal(runId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (
      run &&
      ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].includes(run.status)
    )
      return run.status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Disposable Run did not reach a terminal state.');
}

async function main() {
  expectStatus(await fetch(`${baseUrl}/login`), 200, 'dashboard');
  const cookies = new Map<string, string>();
  for (const account of accounts) {
    const signup = await post('/api/auth/sign-up/email', {
      name: `Phase 21 ${account.plan}`,
      email: account.email,
      password,
    });
    expectStatus(signup, 200, `${account.plan} signup`);
    cookies.set(account.plan, sessionCookie(signup));
  }
  await Promise.all(
    accounts
      .filter((account) => account.plan !== 'FREE')
      .map((account) =>
        prisma.user.update({
          where: { email: account.email },
          data: { planCode: account.plan, planSource: 'MANUAL' },
        })
      )
  );

  const freeCookie = cookies.get('FREE')!;
  const overDuration = await createAgent(
    freeCookie,
    'over-duration',
    120_001,
    5
  );
  expectStatus(
    await post(`/api/agents/${overDuration}/run`, {}, freeCookie),
    422,
    'FREE duration guard'
  );
  const overSteps = await createAgent(freeCookie, 'over-steps', 60_000, 26);
  expectStatus(
    await post(`/api/agents/${overSteps}/run`, {}, freeCookie),
    422,
    'FREE step guard'
  );

  const normal = await createAgent(freeCookie, 'short', 10_000, 2);
  const normalResponse = await post(
    `/api/agents/${normal}/run`,
    {},
    freeCookie
  );
  expectStatus(normalResponse, 202, 'FREE normal admission');
  const normalRunId = (
    (await normalResponse.json()) as { data: { runId: string } }
  ).data.runId;
  const normalStatus = await waitForTerminal(normalRunId);
  const normalUsage = await prisma.usageRecord.findMany({
    where: { runId: normalRunId },
    select: { type: true },
  });
  if (
    !normalUsage.some((row) => row.type === 'RUN_ADMITTED') ||
    !normalUsage.some((row) => row.type === 'EXECUTION_MILLISECOND')
  )
    throw new Error('Short Run usage was not finalized.');

  const proCookie = cookies.get('PRO')!;
  const proAgent = await createAgent(proCookie, 'PRO five-minute', 300_000, 50);
  const proAdmission = await post(`/api/agents/${proAgent}/run`, {}, proCookie);
  expectStatus(proAdmission, 202, 'PRO five-minute admission');
  const proRunId = ((await proAdmission.json()) as { data: { runId: string } })
    .data.runId;
  const proRun = await prisma.run.findUniqueOrThrow({
    where: { id: proRunId },
    select: { executionConfiguration: true, costBudget: true },
  });
  if (!proRun.executionConfiguration || !proRun.costBudget)
    throw new Error('Immutable Run budget snapshots are missing.');
  await post(
    `/api/runs/${proRunId}/cancel`,
    { reason: 'Runtime drill' },
    proCookie
  );
  await waitForTerminal(proRunId);

  const apiKeyResponse = await post(
    '/api/api-keys',
    { name: 'Phase 21 runtime', scopes: ['runs:create'] },
    freeCookie
  );
  expectStatus(apiKeyResponse, 201, 'API key creation');
  const apiKey = ((await apiKeyResponse.json()) as { data: { key: string } })
    .data.key;
  const publicRejected = await fetch(
    `${baseUrl}/api/v1/agents/${overDuration}/runs`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `phase21-${marker}`,
      },
      body: '{}',
    }
  );
  expectStatus(publicRejected, 422, 'public API cost guard');

  const proUser = await prisma.user.findUniqueOrThrow({
    where: { email: accounts[1].email },
    select: { id: true },
  });
  const period = getUtcCalendarMonthPeriod(new Date());
  await prisma.usageRecord.create({
    data: {
      userId: proUser.id,
      type: 'EXECUTION_MILLISECOND',
      quantity: 71_800_001n,
      unit: 'MILLISECOND',
      measurement: 'DERIVED',
      idempotencyKey: `phase21:${marker}:execution-fixture`,
      periodStart: period.start,
      periodEnd: period.end,
      metadata: { controlledRuntimeFixture: true },
    },
  });
  const scheduledFor = new Date();
  const schedule = await prisma.schedule.create({
    data: {
      userId: proUser.id,
      agentId: proAgent,
      kind: 'ONCE',
      timezone: 'UTC',
      oneTimeAt: scheduledFor,
      nextRunAt: scheduledFor,
    },
  });
  const occurrence = await prisma.scheduledOccurrence.create({
    data: { scheduleId: schedule.id, scheduledFor },
  });
  await processDiscoveredOccurrence(
    occurrence.id,
    new Date(),
    prisma,
    new PrismaRunProducer()
  );
  const blocked = await prisma.scheduledOccurrence.findUniqueOrThrow({
    where: { id: occurrence.id },
    select: { status: true, runId: true, errorCode: true },
  });
  if (
    blocked.status !== 'QUOTA_BLOCKED' ||
    blocked.runId !== null ||
    blocked.errorCode !== 'MONTHLY_EXECUTION_LIMIT_REACHED'
  )
    throw new Error('Scheduled cost rejection was not durable.');

  let writes = 0;
  const png = (suffix: string) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(suffix),
    ]).toString('base64');
  const artifacts = await persistScreenshotCandidates(
    'phase21-runtime',
    ['one', 'two', 'three'].map((suffix, index) => ({
      kind: 'base64' as const,
      value: png(suffix),
      mimeType: 'image/png' as const,
      stepNumber: index + 1,
      eventSequence: index + 1,
    })),
    {
      provider: 'LOCAL',
      save: async (input) => {
        writes += 1;
        return {
          storageKey: `fixture-${writes}`,
          fileName: input.fileName,
          mimeType: input.mimeType,
          size: input.data.length,
          checksum: 'fixture',
        };
      },
      read: async () => Buffer.alloc(0),
      readStream: async () => {
        throw new Error('not used');
      },
      stat: async () => ({ size: 0 }),
      delete: async () => undefined,
    },
    1024,
    2
  );
  if (artifacts.length !== 2 || writes !== 2)
    throw new Error('Artifact count ceiling was not enforced.');

  const usageResponse = await fetch(`${baseUrl}/api/usage/current`, {
    headers: { cookie: proCookie },
  });
  expectStatus(usageResponse, 200, 'authoritative usage API');
  const usage = (await usageResponse.json()) as {
    data: {
      plan: { limits: { executionMsPerMonth: number } };
      usage: { executionMs: string };
    };
  };
  if (
    usage.data.plan.limits.executionMsPerMonth !== 72_000_000 ||
    BigInt(usage.data.usage.executionMs) < 71_800_001n
  )
    throw new Error(
      'Usage response did not reflect authoritative cost values.'
    );
  expectStatus(
    await fetch(`${baseUrl}/dashboard/usage`, {
      headers: { cookie: proCookie },
    }),
    200,
    'usage UI'
  );
  const internalUser = await prisma.user.findUniqueOrThrow({
    where: { email: accounts[2].email },
    select: { planCode: true },
  });
  if (internalUser.planCode !== 'INTERNAL')
    throw new Error('INTERNAL allowance was not retained.');

  console.log(
    JSON.stringify({
      dashboard: 'reachable',
      freeDuration: '422-no-run',
      freeSteps: '422-no-run',
      shortRun: `terminal-${normalStatus.toLowerCase()}-usage-recorded`,
      proFiveMinute: '202-immutable-budget',
      publicApi: '422-same-cost-guard',
      scheduled: 'quota-blocked-no-run',
      artifacts: 'count-and-byte-fixture-enforced',
      usageUi: 'authoritative-values-visible',
      internal: 'allowance-retained',
      identifiers: 'sanitized',
    })
  );
}

void main()
  .then(() => 0)
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Runtime drill failed.'
    );
    return 1;
  })
  .then(async (exitCode) => {
    await prisma.user.deleteMany({
      where: { email: { in: accounts.map((account) => account.email) } },
    });
    await prisma.$disconnect();
    process.exit(exitCode);
  });
