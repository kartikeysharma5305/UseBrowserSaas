import { randomBytes } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright';
import Redis from 'ioredis';

import { prisma } from '../src/lib/db/prisma';
import { getBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';
import { getPlan } from '../src/lib/plans/catalogue';
import { registerRuntimeUser } from './runtime-beta-registration';

const origin = 'http://localhost:3001';
const nonce = randomBytes(6).toString('hex');
const password = `Phase13-${nonce}-Disposable!`;
const queue = getBrowserRunQueue();
const browser = await chromium.launch({ headless: true });
const ownerContext = await browser.newContext();
const controlContext = await browser.newContext();
let ownerId: string | null = null;
let controlId: string | null = null;
const storageKeys: Array<{ provider: 'LOCAL' | 'S3'; key: string }> = [];
const evidence = {
  oneTimePlaintext: false,
  listRedaction: false,
  agentRead: false,
  missingScopeDenied: false,
  idempotentAdmission: false,
  changedBodyConflict: false,
  oneRunOneJob: false,
  resultStateSafe: false,
  artifactAuthorized: false,
  crossUserDenied: false,
  rateLimited: false,
  revokeImmediate: false,
  deletionImmediate: false,
  auditRecords: false,
  cleanup: false,
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function register(context: BrowserContext, label: string) {
  const email = `phase13-${label}-${nonce}@example.invalid`;
  const page = await registerRuntimeUser({
    context,
    origin,
    email,
    name: `Phase 13 ${label}`,
    password,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { page, user };
}

async function sessionApi(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { path, method, body }
  ) as Promise<{ status: number; body: any }>;
}

async function publicApi(key: string, path: string, method = 'GET', body?: unknown, idempotencyKey?: string) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

try {
  await queue.pause();
  const owner = await register(ownerContext, 'owner');
  const control = await register(controlContext, 'control');
  ownerId = owner.user.id;
  controlId = control.user.id;

  const agentResponse = await sessionApi(owner.page, '/api/agents', 'POST', {
    name: 'Phase 13 disposable Agent',
    goal: 'Return the declared query as a short structured result.',
    targetWebsite: 'https://example.com',
    status: 'ACTIVE',
    scheduleType: 'MANUAL',
    scheduleConfig: {},
    configuration: { model: 'groq_llama-3.3-70b-versatile', maxSteps: 5, timeoutMs: 60000, browserSettings: { headless: true, viewportWidth: 1280, viewportHeight: 720 } },
    variables: [{ key: 'query', label: 'Query', type: 'TEXT', required: true, constraints: { maxLength: 100 }, displayOrder: 0 }],
    outputSchema: { enabled: true, version: 1, mode: 'STRICT', fields: [{ key: 'answer', label: 'Answer', type: 'string', required: true }] },
  });
  assert(agentResponse.status === 201, 'Owner Agent creation failed.');
  const agentId = agentResponse.body.data.id as string;
  const controlAgent = await prisma.agent.create({ data: { userId: control.user.id, name: 'Control Agent', goal: 'Control', targetWebsite: 'https://example.org', status: 'ACTIVE', scheduleType: 'MANUAL', scheduleConfig: {}, configuration: { model: 'groq_llama-3.3-70b-versatile', maxSteps: 5, timeoutMs: 60000, browserSettings: { headless: true, viewportWidth: 1280, viewportHeight: 720 } } } });
  const controlRun = await prisma.run.create({ data: { agentId: controlAgent.id, status: 'SUCCESS', source: 'MANUAL', result: { summary: 'control', visitedUrls: [] } } });
  const controlArtifact = await prisma.runArtifact.create({
    data: {
      runId: controlRun.id,
      type: 'SCREENSHOT',
      storageProvider: 'LOCAL',
      storageKey: `phase13-control/${nonce}.png`,
      checksum: '0'.repeat(64),
      fileName: 'control.png',
      mimeType: 'image/png',
      size: 8,
    },
  });

  const createdKey = await sessionApi(owner.page, '/api/api-keys', 'POST', {
    name: 'Disposable automation',
    scopes: ['agents:read', 'runs:read', 'runs:create', 'results:read', 'artifacts:read'],
    expiresAt: null,
  });
  assert(createdKey.status === 201, 'API key creation failed.');
  const key = createdKey.body.data.key as string;
  const keyId = createdKey.body.data.id as string;
  evidence.oneTimePlaintext = /^bua_(?:live|test)_/.test(key);
  const listed = await sessionApi(owner.page, '/api/api-keys');
  const serializedList = JSON.stringify(listed.body);
  evidence.listRedaction = listed.status === 200 && !serializedList.includes(key) && !serializedList.includes(key.split('.')[1]);

  const agents = await publicApi(key, '/api/v1/agents');
  const agent = await publicApi(key, `/api/v1/agents/${agentId}`);
  evidence.agentRead = agents.status === 200 && agent.status === 200 && !JSON.stringify(agent.body).includes(owner.user.id) && !JSON.stringify(agent.body).includes('configuration');
  const deniedCancel = await publicApi(key, `/api/v1/runs/${controlRun.id}/cancel`, 'POST', {});
  evidence.missingScopeDenied = deniedCancel.status === 403;

  const idem = `phase13-${nonce}`;
  const [first, replay] = await Promise.all([
    publicApi(key, `/api/v1/agents/${agentId}/runs`, 'POST', { variables: { query: 'first' } }, idem),
    publicApi(key, `/api/v1/agents/${agentId}/runs`, 'POST', { variables: { query: 'first' } }, idem),
  ]);
  assert(first.status === 202 && replay.status === 202, 'Idempotent API admission failed.');
  const runId = first.body.data.id as string;
  evidence.idempotentAdmission = runId === replay.body.data.id && [first.body.data.idempotencyReplayed, replay.body.data.idempotencyReplayed].includes(true);
  const conflict = await publicApi(key, `/api/v1/agents/${agentId}/runs`, 'POST', { variables: { query: 'changed' } }, idem);
  evidence.changedBodyConflict = conflict.status === 409 && conflict.body.error.code === 'IDEMPOTENCY_CONFLICT';
  const job = await queue.getJob(runId);
  evidence.oneRunOneJob = (await prisma.run.count({ where: { id: runId } })) === 1 && Boolean(job) && (await prisma.usageRecord.count({ where: { runId, type: 'RUN_ADMITTED' } })) === 1;

  const runStatus = await publicApi(key, `/api/v1/runs/${runId}`);
  const result = await publicApi(key, `/api/v1/runs/${runId}/result`);
  evidence.resultStateSafe = runStatus.status === 200 && result.status === 200 && result.body.data.status === 'PENDING' && !JSON.stringify(result.body).match(/structuredRawResult|structuredCandidate|executionTask|workerId/);

  const storage = createArtifactStorage('LOCAL');
  const saved = await storage.save({ runId, fileName: 'phase13.png', mimeType: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') });
  storageKeys.push({ provider: 'LOCAL', key: saved.storageKey });
  const artifact = await prisma.runArtifact.create({ data: { runId, type: 'SCREENSHOT', storageProvider: 'LOCAL', storageKey: saved.storageKey, checksum: saved.checksum, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size } });
  const artifactList = await publicApi(key, `/api/v1/runs/${runId}/artifacts`);
  const artifactDownload = await fetch(`${origin}/api/v1/artifacts/${artifact.id}`, { headers: { authorization: `Bearer ${key}` } });
  evidence.artifactAuthorized = artifactList.status === 200 && artifactDownload.status === 200 && (await artifactDownload.arrayBuffer()).byteLength === saved.size && !JSON.stringify(artifactList.body).includes(saved.storageKey);

  const crossStatuses = await Promise.all([
    publicApi(key, `/api/v1/agents/${controlAgent.id}`),
    publicApi(key, `/api/v1/runs/${controlRun.id}`),
    publicApi(key, `/api/v1/runs/${controlRun.id}/result`),
    publicApi(key, `/api/v1/artifacts/${controlArtifact.id}`),
  ]);
  evidence.crossUserDenied = crossStatuses.every((item) => item.status === 404);

  const redis = new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  await redis.connect();
  const bucket = Math.floor(Date.now() / 60_000);
  const limit = getPlan(owner.user.planCode).limits.apiKeyRequestsPerMinute;
  await redis.set(`public-api:key:${keyId}:${bucket}`, String(limit), 'PX', 60_000);
  redis.disconnect();
  const limited = await publicApi(key, '/api/v1/agents?limit=1');
  evidence.rateLimited =
    limited.status === 429 && limited.body.error?.code === 'RATE_LIMITED';

  assert((await sessionApi(owner.page, `/api/api-keys/${keyId}`, 'DELETE')).status === 200, 'Revocation failed.');
  evidence.revokeImmediate = (await publicApi(key, '/api/v1/agents')).status === 401;

  const deletionKeyResponse = await sessionApi(owner.page, '/api/api-keys', 'POST', { name: 'Deletion check', scopes: ['agents:read'] });
  assert(deletionKeyResponse.status === 201, 'Deletion key creation failed.');
  const deletionKey = deletionKeyResponse.body.data.key as string;
  const deletion = await sessionApi(owner.page, '/api/account/delete', 'POST', { confirmation: 'DELETE' });
  evidence.deletionImmediate = [200, 202].includes(deletion.status) && (await publicApi(deletionKey, '/api/v1/agents')).status === 401;
  evidence.auditRecords = (await prisma.apiAuditEvent.count({ where: { userId: owner.user.id, action: { in: ['API_KEY_CREATED', 'API_KEY_REVOKED', 'API_RUN_ADMITTED'] } } })) >= 3;
} finally {
  await browser.close();
  for (const item of storageKeys) await createArtifactStorage(item.provider).delete(item.key).catch(() => undefined);
  if (ownerId || controlId) await prisma.user.deleteMany({ where: { id: { in: [ownerId, controlId].filter((id): id is string => Boolean(id)) } } });
  await queue.drain(true).catch(() => undefined);
  await queue.resume().catch(() => undefined);
  evidence.cleanup = (await prisma.user.count({ where: { id: { in: [ownerId, controlId].filter((id): id is string => Boolean(id)) } } })) === 0;
  await queue.close();
  await prisma.$disconnect();
}

const failed = Object.entries(evidence).filter(([, value]) => !value).map(([key]) => key);
if (failed.length) throw new Error(`Phase 13 runtime assertions failed: ${failed.join(', ')}`);
console.info(JSON.stringify({ phase: 13, status: 'passed', evidence }));
