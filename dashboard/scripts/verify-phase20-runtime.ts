import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

import { prisma } from '../src/lib/db/prisma';
import {
  discoverDueSchedule,
  processDiscoveredOccurrence,
} from '../src/lib/scheduling/processor';

const baseUrl = process.env.PHASE20_BASE_URL ?? 'http://localhost:3001';
const marker = randomUUID().replaceAll('-', '');
const password = `Phase20-${marker}!aA1`;
const emails = [
  `phase20-a-${marker}@example.invalid`,
  `phase20-b-${marker}@example.invalid`,
];
let emergencyServer: ChildProcess | null = null;

async function startEmergencyDashboard() {
  if (process.env.PHASE20_VERIFY_EMERGENCY !== 'true') return null;
  emergencyServer = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', '3002'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXECUTION_ENABLED: ['f', 'a', 'l', 's', 'e'].join(''),
        BETTER_AUTH_URL: 'http://localhost:3002',
      },
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch('http://localhost:3002/login')).ok)
        return 'http://localhost:3002';
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Emergency dashboard did not start.');
}

function cookie(response: Response) {
  const value = response.headers.get('set-cookie') ?? '';
  const match = /([^=;, ]*session[^=;, ]*)=([^;]+)/i.exec(value);
  if (!match) throw new Error('Session cookie was not issued.');
  return `${match[1]}=${match[2]}`;
}

async function json(
  path: string,
  body: unknown,
  options: { cookie?: string; origin?: string } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
      origin: options.origin ?? baseUrl,
    },
    body: JSON.stringify(body),
  });
}

function assertStatus(response: Response, expected: number, name: string) {
  if (response.status !== expected)
    throw new Error(
      `${name} returned ${response.status}, expected ${expected}.`
    );
}

async function main() {
  const emergencyUrl = await startEmergencyDashboard();
  const home = await fetch(`${baseUrl}/login`);
  assertStatus(home, 200, 'dashboard');

  const firstSignup = await json('/api/auth/sign-up/email', {
    name: 'Phase 20 disposable A',
    email: emails[0],
    password,
  });
  assertStatus(firstSignup, 200, 'first signup');
  const firstCookie = cookie(firstSignup);
  const secondSignup = await json('/api/auth/sign-up/email', {
    name: 'Phase 20 disposable B',
    email: emails[1],
    password,
  });
  assertStatus(secondSignup, 200, 'second signup');

  const failureStatuses: number[] = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await json('/api/auth/sign-in/email', {
      email: emails[0],
      password: `wrong-${marker}`,
    });
    failureStatuses.push(response.status);
  }
  if (
    failureStatuses.at(-1) !== 429 ||
    failureStatuses.slice(0, 8).includes(429)
  )
    throw new Error('Login cooldown boundary was not deterministic.');

  const unrelated = await json('/api/auth/sign-in/email', {
    email: emails[1],
    password,
  });
  assertStatus(unrelated, 200, 'unrelated login');

  const crossOrigin = await json(
    '/api/account/delete',
    { confirmation: 'NO' },
    { cookie: firstCookie, origin: 'https://controlled-invalid-origin.example' }
  );
  assertStatus(crossOrigin, 403, 'cross-origin mutation');
  const sameOrigin = await json(
    '/api/account/delete',
    { confirmation: 'NO' },
    { cookie: firstCookie, origin: baseUrl }
  );
  assertStatus(sameOrigin, 400, 'same-origin mutation');

  const oversized = await json(
    '/api/agents',
    {
      name: 'oversized',
      goal: 'x'.repeat(70_000),
      targetWebsite: 'https://example.com',
    },
    { cookie: firstCookie, origin: baseUrl }
  );
  assertStatus(oversized, 413, 'oversized request');

  const agentResponse = await json(
    '/api/agents',
    {
      name: 'Phase 20 disposable',
      goal: 'Visit the page.',
      targetWebsite:
        process.env.PHASE20_VERIFY_RECOVERY === 'true'
          ? 'https://phase20.invalid'
          : 'https://example.com',
      status: 'ACTIVE',
    },
    { cookie: firstCookie, origin: baseUrl }
  );
  assertStatus(agentResponse, 201, 'agent creation');
  const agent = (await agentResponse.json()) as { data: { id: string } };
  if (emergencyUrl) {
    const disabled = await fetch(
      `${emergencyUrl}/api/agents/${agent.data.id}/run`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: firstCookie,
          origin: emergencyUrl,
        },
        body: '{}',
      }
    );
    assertStatus(disabled, 503, 'emergency execution shutdown');
  }
  if (process.env.PHASE20_EXPECT_EXECUTION_DISABLED === 'true') {
    const disabled = await json(
      `/api/agents/${agent.data.id}/run`,
      {},
      { cookie: firstCookie, origin: baseUrl }
    );
    assertStatus(disabled, 503, 'emergency execution shutdown');
    for (const sessionCookie of [firstCookie, cookie(unrelated)]) {
      const deletion = await json(
        '/api/account/delete',
        { confirmation: 'DELETE' },
        { cookie: sessionCookie, origin: baseUrl }
      );
      assertStatus(deletion, 202, 'disposable cleanup');
    }
    console.log(
      JSON.stringify({
        emergencyExecution: '503-no-run',
        recoveryProcess: 'requires-enabled-restart',
        cleanup: 'completed',
        identifiers: 'sanitized',
      })
    );
    return;
  }
  if (process.env.PHASE20_VERIFY_RECOVERY === 'true') {
    const admitted = await json(
      `/api/agents/${agent.data.id}/run`,
      {},
      { cookie: firstCookie, origin: baseUrl }
    );
    assertStatus(admitted, 202, 're-enabled Run admission');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: emails[0] },
      select: { id: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { planCode: 'PRO' },
    });
    const apiKeyResponse = await json(
      '/api/api-keys',
      { name: 'Phase 20 disposable', scopes: ['agents:read'] },
      { cookie: firstCookie, origin: baseUrl }
    );
    assertStatus(apiKeyResponse, 201, 'API key creation');
    const apiKey = (await apiKeyResponse.json()) as {
      data: { key: string };
    };
    const publicApi = await fetch(`${baseUrl}/api/v1/agents`, {
      headers: {
        authorization: `Bearer ${apiKey.data.key}`,
        origin: 'https://controlled-client.example',
      },
    });
    assertStatus(publicApi, 200, 'valid bearer API');
    const dueAt = new Date(Date.now() + 60_000);
    const scheduleResponse = await json(
      '/api/schedules',
      {
        agentId: agent.data.id,
        kind: 'ONCE',
        timezone: 'UTC',
        oneTimeAt: dueAt.toISOString(),
      },
      { cookie: firstCookie, origin: baseUrl }
    );
    assertStatus(scheduleResponse, 201, 'shutdown schedule creation');
    const schedule = (await scheduleResponse.json()) as {
      data: { id: string };
    };
    const processAt = new Date(dueAt.getTime() + 1_000);
    const occurrence = await discoverDueSchedule(schedule.data.id, processAt);
    if (!occurrence) throw new Error('Shutdown occurrence was not discovered.');
    const previousExecutionState = process.env.EXECUTION_ENABLED;
    process.env.EXECUTION_ENABLED = ['f', 'a', 'l', 's', 'e'].join('');
    await processDiscoveredOccurrence(occurrence.id, processAt);
    if (previousExecutionState === undefined)
      delete process.env.EXECUTION_ENABLED;
    else process.env.EXECUTION_ENABLED = previousExecutionState;
    const blockedOccurrence =
      await prisma.scheduledOccurrence.findUniqueOrThrow({
        where: { id: occurrence.id },
        select: { status: true, errorCode: true, runId: true },
      });
    if (
      blockedOccurrence.status !== 'PLAN_BLOCKED' ||
      blockedOccurrence.errorCode !== 'EXECUTION_DISABLED' ||
      blockedOccurrence.runId !== null
    )
      throw new Error('Scheduler shutdown state was not recorded safely.');
    for (const sessionCookie of [firstCookie, cookie(unrelated)]) {
      const deletion = await json(
        '/api/account/delete',
        { confirmation: 'DELETE' },
        { cookie: sessionCookie, origin: baseUrl }
      );
      assertStatus(deletion, 202, 'disposable cleanup');
    }
    console.log(
      JSON.stringify({
        executionRecovery: '202-admitted',
        scheduledShutdown: 'PLAN_BLOCKED-no-run',
        publicApi: 'valid-bearer-200',
        cleanup: 'completed',
        identifiers: 'sanitized',
      })
    );
    return;
  }
  await prisma.run.createMany({
    data: Array.from({ length: 20 }, () => ({
      agentId: agent.data.id,
      status: 'SUCCESS' as const,
      completedAt: new Date(),
    })),
  });
  const burst = await json(
    `/api/agents/${agent.data.id}/run`,
    {},
    { cookie: firstCookie, origin: baseUrl }
  );
  assertStatus(burst, 429, 'Run burst admission');
  const activeAfterBurst = await prisma.run.count({
    where: { agentId: agent.data.id, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (activeAfterBurst !== 0)
    throw new Error('Burst rejection created active work.');

  const bearer = await fetch(`${baseUrl}/api/v1/agents`, {
    headers: {
      authorization: 'Bearer malformed',
      origin: 'https://controlled-client.example',
    },
  });
  assertStatus(bearer, 401, 'bearer CSRF boundary');

  const secondCookie = cookie(unrelated);
  for (const sessionCookie of [firstCookie, secondCookie]) {
    const deletion = await json(
      '/api/account/delete',
      { confirmation: 'DELETE' },
      { cookie: sessionCookie, origin: baseUrl }
    );
    assertStatus(deletion, 202, 'disposable cleanup');
  }
  const remaining = await prisma.user.count({
    where: { email: { in: emails } },
  });
  if (remaining !== 0) throw new Error('Disposable users were not removed.');

  console.log(
    JSON.stringify({
      dashboard: 'reachable',
      signup: 'accepted',
      loginCooldown: '429',
      unrelatedLogin: 'accepted',
      csrfCrossOrigin: '403',
      csrfSameOrigin: 'passed',
      oversizedBody: '413',
      runBurst: '429-no-run',
      bearerApi: 'not-csrf-blocked',
      emergencyExecution: emergencyUrl ? '503-no-run' : 'not-requested',
      cleanup: 'completed',
      identifiers: 'sanitized',
    })
  );
}

main()
  .catch(async (error) => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    console.error(
      error instanceof Error ? error.message : 'Phase 20 runtime drill failed.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    emergencyServer?.kill();
    await prisma.$disconnect();
  });
