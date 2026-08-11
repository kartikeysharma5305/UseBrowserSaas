import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PrismaClient } from '@prisma/client';
import { RedisMemoryServer } from 'redis-memory-server';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const baseUrl = 'http://localhost:3001';
const marker = randomUUID().replaceAll('-', '');
const password = `Phase25-${marker}!aA1`;
const secretMarker = `phase25-secret-${marker}`;
const controlMarker = `phase25-control-${marker}`;
const redis = await RedisMemoryServer.create();
const redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
const environment = { ...process.env, REDIS_URL: redisUrl };
let stack: ChildProcess | undefined;
let prisma: PrismaClient | undefined;
const userIds: string[] = [];
let output = '';

function cookie(response: Response) {
  const value = response.headers.get('set-cookie') ?? '';
  const match = /([^=;, ]*session[^=;, ]*)=([^;]+)/i.exec(value);
  if (!match) throw new Error('Signup did not issue a session.');
  return `${match[1]}=${match[2]}`;
}

async function request(pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, init);
}

async function signup(label: string) {
  const email = `phase25-${label}-${marker}@example.invalid`;
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: `Phase 25 ${label}`, email, password }),
  });
  if (!response.ok) throw new Error(`Disposable ${label} signup failed.`);
  const user = await prisma!.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  return { user, cookie: cookie(response) };
}

async function stop(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    await execFileAsync('taskkill.exe', [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ]).catch(() => undefined);
  else child.kill('SIGKILL');
}

async function waitForReady() {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (stack?.exitCode !== null)
      throw new Error(`dev:all exited early.\n${output.slice(-3_000)}`);
    const response = await request('/register').catch(() => null);
    if (response?.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev:all did not become ready.\n${output.slice(-3_000)}`);
}

try {
  stack = spawn(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', 'pnpm dev:all'],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  const capture = (chunk: Buffer | string) => {
    output = `${output}${String(chunk)}`
      .replaceAll(secretMarker, '[REDACTED]')
      .slice(-20_000);
  };
  stack.stdout?.on('data', capture);
  stack.stderr?.on('data', capture);
  await waitForReady();

  const database = await import('../src/lib/db/prisma');
  const crypto = await import('../src/lib/webhooks/crypto');
  prisma = database.prisma;
  const register = await request('/register');
  const registerText = await register.text();
  for (const link of ['/privacy', '/terms', '/acceptable-use'])
    if (!registerText.includes(link))
      throw new Error(`Signup omitted ${link}.`);
  for (const page of ['/privacy', '/terms', '/acceptable-use', '/cookies']) {
    const response = await request(page);
    if (response.status !== 200) throw new Error(`${page} was not public.`);
  }

  const owner = await signup('owner');
  const control = await signup('control');
  const headers = {
    cookie: owner.cookie,
    origin: baseUrl,
    'content-type': 'application/json',
  };
  const acceptance = await request('/api/legal/acceptance', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documents: ['TERMS', 'PRIVACY', 'ACCEPTABLE_USE'],
    }),
  });
  if (!acceptance.ok) throw new Error('Legal acceptance failed.');
  if (
    (await prisma.legalDocumentAcceptance.count({
      where: { userId: owner.user.id },
    })) !== 3
  )
    throw new Error('Current document versions were not persisted once.');
  await request('/api/legal/acceptance', {
    method: 'POST',
    headers,
    body: JSON.stringify({ documents: ['TERMS', 'PRIVACY', 'ACCEPTABLE_USE'] }),
  });
  if (
    (await prisma.legalDocumentAcceptance.count({
      where: { userId: owner.user.id },
    })) !== 3
  )
    throw new Error('Duplicate acceptance was not idempotent.');

  const agent = await prisma.agent.create({
    data: {
      userId: owner.user.id,
      name: 'Phase 25 owned Agent',
      goal: 'Portable owned fixture',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {},
    },
  });
  await prisma.run.create({
    data: {
      agentId: agent.id,
      status: 'SUCCESS',
      attempt: 1,
      completedAt: new Date(),
      result: { summary: 'Owned portable result' },
      events: {
        create: {
          sequence: 1,
          type: 'RUN_COMPLETED',
          message: 'Owned fixture completed.',
        },
      },
    },
  });
  await prisma.agent.create({
    data: {
      userId: control.user.id,
      name: controlMarker,
      goal: controlMarker,
      targetWebsite: 'https://example.com',
      status: 'PAUSED',
      configuration: {},
    },
  });
  await prisma.apiKey.create({
    data: {
      userId: owner.user.id,
      name: 'Private fixture',
      keyPrefix: `bua_test_${marker.slice(0, 16)}`,
      keyHash: secretMarker,
      scopes: ['runs:read'],
    },
  });
  const protectedSecret = crypto.protectSigningSecret(secretMarker);
  await prisma.webhookEndpoint.create({
    data: {
      userId: owner.user.id,
      name: 'Private endpoint',
      url: 'https://example.com/hook',
      eventTypes: ['run.completed'],
      ...protectedSecret,
    },
  });

  const settings = await request('/dashboard/settings', {
    headers: { cookie: owner.cookie },
  });
  if (!(await settings.text()).includes('Download my data'))
    throw new Error('Settings omitted the privacy export surface.');
  const exported = await request('/api/account/export', {
    method: 'POST',
    headers,
  });
  const exportedText = await exported.text();
  if (
    exported.status !== 200 ||
    !exportedText.includes('Phase 25 owned Agent') ||
    !exportedText.includes('Owned portable result') ||
    exportedText.includes(controlMarker) ||
    exportedText.includes(secretMarker) ||
    exportedText.includes('secretCiphertext') ||
    exportedText.includes('keyHash') ||
    exportedText.includes('storageKey')
  )
    throw new Error('Runtime export privacy assertions failed.');
  const controlExport = await request('/api/account/export', {
    method: 'POST',
    headers: {
      cookie: control.cookie,
      origin: baseUrl,
      'content-type': 'application/json',
    },
  });
  const controlText = await controlExport.text();
  if (!controlText.includes(controlMarker) || controlText.includes(agent.id))
    throw new Error('Cross-user export isolation failed.');
  await request('/api/account/export', { method: 'POST', headers });
  const rateLimited = await request('/api/account/export', {
    method: 'POST',
    headers,
  });
  if (rateLimited.status !== 429)
    throw new Error('Export rate limit was not enforced.');

  await prisma.legalDocumentAcceptance.deleteMany({
    where: { userId: owner.user.id, documentType: 'TERMS' },
  });
  await prisma.legalDocumentAcceptance.create({
    data: {
      userId: owner.user.id,
      documentType: 'TERMS',
      documentVersion: 'obsolete-fixture',
    },
  });
  const obsoleteStatus = await request('/api/legal/acceptance', {
    headers: { cookie: owner.cookie },
  });
  const obsoleteJson = (await obsoleteStatus.json()) as any;
  if (!obsoleteJson.data?.requiresAcceptance)
    throw new Error('Obsolete legal version was not detected.');

  const deletion = await request('/api/account/delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmation: 'DELETE' }),
  });
  if (deletion.status !== 202) throw new Error('Account deletion failed.');
  const deletionRow = await prisma.accountDeletion.findUnique({
    where: { userId: owner.user.id },
  });
  if (deletionRow?.status !== 'COMPLETED')
    throw new Error('Account deletion did not complete durably.');
  const deletedExport = await request('/api/account/export', {
    method: 'POST',
    headers,
  });
  if (deletedExport.status !== 401)
    throw new Error('Deleted session could still export.');

  console.info(
    JSON.stringify({
      devAllReady: true,
      publicLegalPages: 4,
      signupLinksVerified: true,
      currentAcceptancesRecorded: 3,
      duplicateAcceptanceIdempotent: true,
      obsoleteVersionDetected: true,
      settingsPrivacySurface: true,
      ownerExportVerified: true,
      crossUserIsolation: true,
      secretMaterialAbsent: true,
      exportRateLimit: rateLimited.status,
      deletionCompleted: true,
      deletedExportDenied: deletedExport.status,
      controlUserRecordsUnaffected: true,
    })
  );
} finally {
  await stop(stack);
  if (prisma && userIds.length)
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma?.$disconnect();
  await redis.stop();
}
