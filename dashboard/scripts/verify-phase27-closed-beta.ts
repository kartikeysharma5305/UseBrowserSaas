import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const origin = process.env.BETA_RUNTIME_URL ?? 'http://127.0.0.1:3017';
const operatorToken = process.env.OBSERVABILITY_TOKEN;
if (!operatorToken || operatorToken.length < 32)
  throw new Error('Runtime operator token is unavailable.');

const suffix = randomBytes(6).toString('hex');
const email = `phase27-${suffix}@example.invalid`;
const unusedEmail = `phase27-unused-${suffix}@example.invalid`;
const overflowEmail = `phase27-overflow-${suffix}@example.invalid`;
const blockedEmail = `phase27-blocked-${suffix}@example.invalid`;
const password = `Beta-${randomBytes(18).toString('base64url')}!`;
let cookie = '';

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}
function cookieFrom(response: Response) {
  const values: string[] = (response.headers as any).getSetCookie?.() ?? [
    response.headers.get('set-cookie') ?? '',
  ];
  return values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Cookie: cookie,
  Origin: origin,
});
const operatorHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${operatorToken}`,
  Origin: origin,
};

try {
  const direct = await json('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: blockedEmail, name: 'Blocked', password }),
  });
  assert(
    direct.response.status === 403,
    `UNINVITED_SIGNUP_STATUS_${direct.response.status}`
  );

  const inviteResult = await json('/api/internal/beta', {
    method: 'POST',
    headers: operatorHeaders,
    body: JSON.stringify({
      email,
      planCode: 'PRO',
      note: 'isolated runtime drill',
    }),
  });
  assert(
    inviteResult.response.status === 201 &&
      inviteResult.body?.data?.inviteToken,
    'INVITE_CREATE_FAILED'
  );
  const inviteToken = inviteResult.body.data.inviteToken as string;
  const inviteId = inviteResult.body.data.id as string;
  const unused = await json('/api/internal/beta', {
    method: 'POST',
    headers: operatorHeaders,
    body: JSON.stringify({ email: unusedEmail, planCode: 'FREE' }),
  });
  assert(unused.response.status === 201, 'UNUSED_INVITE_CREATE_FAILED');
  const overflow = await json('/api/internal/beta', {
    method: 'POST',
    headers: operatorHeaders,
    body: JSON.stringify({ email: overflowEmail, planCode: 'FREE' }),
  });
  assert(overflow.response.status === 409, 'BETA_CAPACITY_NOT_ENFORCED');

  const registration = await json('/api/beta/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      inviteToken,
      email,
      name: 'Phase 27 disposable',
      password,
      legalAccepted: true,
    }),
  });
  assert(
    registration.response.ok,
    `INVITED_REGISTRATION_STATUS_${registration.response.status}`
  );
  cookie = cookieFrom(registration.response);
  assert(cookie, 'REGISTRATION_SESSION_MISSING');
  const user = await prisma.user.findUnique({
    where: { email },
    include: { legalAcceptances: true },
  });
  assert(
    user?.betaAccessStatus === 'ACTIVE' && user.legalAcceptances.length >= 3,
    'BETA_ACTIVATION_OR_LEGAL_FAILED'
  );
  const persistedInvite = await prisma.betaInvite.findUnique({
    where: { id: inviteId },
  });
  assert(
    persistedInvite?.status === 'ACCEPTED' &&
      persistedInvite.tokenHash !== inviteToken,
    'INVITE_PERSISTENCE_UNSAFE'
  );

  const created = await json('/api/templates/webpage-summarizer/create-agent', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      name: 'Phase 27 safe check',
      goal: 'Read {{website}}, return the page title, and stop.',
      targetWebsite: 'https://example.com',
      createAndTest: false,
    }),
  });
  assert(
    created.response.status === 201,
    `TEMPLATE_AGENT_CREATE_STATUS_${created.response.status}_${String(
      created.body?.code ?? created.body?.error ?? 'unknown'
    )
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80)}`
  );
  const agentId = created.body.data.agent.id as string;
  const scheduleResponse = await json('/api/schedules', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      agentId,
      kind: 'DAILY',
      timezone: 'UTC',
      localTime: '23:59',
      variables: { website: 'https://example.com' },
    }),
  });
  assert(scheduleResponse.response.status === 201, 'SCHEDULE_CREATE_FAILED');
  const scheduleId = scheduleResponse.body.data.id as string;
  const apiKeyResponse = await json('/api/api-keys', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'Phase 27 runtime', scopes: ['runs:create'] }),
  });
  assert(apiKeyResponse.response.status === 201, 'API_KEY_CREATE_FAILED');
  const apiKey = apiKeyResponse.body.data.key as string;
  const runResponse = await json(`/api/agents/${agentId}/run`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ variables: { website: 'https://example.com' } }),
  });
  assert(runResponse.response.status === 202, 'REAL_RUN_ADMISSION_FAILED');
  const runId = runResponse.body.data.runId as string;
  let runStatus = 'QUEUED';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    runStatus = run?.status ?? 'MISSING';
    if (!['QUEUED', 'RUNNING'].includes(runStatus)) break;
  }
  if (runStatus === 'RUNNING') {
    await json(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        reason: 'Bounded closed-beta runtime drill completed.',
      }),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const run = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      runStatus = run?.status ?? 'MISSING';
      if (!['QUEUED', 'RUNNING'].includes(runStatus)) break;
    }
  }
  assert(
    ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].includes(runStatus),
    `REAL_RUN_NOT_TERMINAL_${runStatus}`
  );

  const feedback = await json('/api/beta/feedback', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      category: 'RUN_FAILURE',
      message: 'Runtime drill feedback without task contents or credentials.',
      contextPath: '/dashboard/runs',
      runId,
    }),
  });
  assert(feedback.response.status === 201, 'FEEDBACK_CREATE_FAILED');
  const snapshot = await json('/api/internal/beta', {
    headers: { Authorization: `Bearer ${operatorToken}` },
  });
  assert(
    snapshot.response.ok &&
      !JSON.stringify(snapshot.body).includes(inviteToken),
    'OPERATOR_SNAPSHOT_UNSAFE'
  );
  assert(
    snapshot.body.feedback.some(
      (item: any) => item.id === feedback.body.data.id
    ),
    'OPERATOR_FEEDBACK_MISSING'
  );

  const suspend = await json(`/api/internal/beta/users/${user.id}`, {
    method: 'PATCH',
    headers: operatorHeaders,
    body: JSON.stringify({ state: 'SUSPENDED' }),
  });
  assert(suspend.response.ok, 'SUSPEND_FAILED');
  const blockedRun = await json(`/api/agents/${agentId}/run`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ variables: { website: 'https://example.com' } }),
  });
  assert(
    blockedRun.response.status === 403 &&
      blockedRun.body?.code === 'BETA_ACCESS_SUSPENDED',
    'SUSPENDED_MANUAL_RUN_NOT_BLOCKED'
  );
  const blockedSchedule = await json(`/api/schedules/${scheduleId}/run-now`, {
    method: 'POST',
    headers: authHeaders(),
  });
  assert(
    blockedSchedule.response.status === 403,
    'SUSPENDED_SCHEDULE_NOT_BLOCKED'
  );
  const blockedApi = await json(`/api/v1/agents/${agentId}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': `phase27-${suffix}`,
    },
    body: JSON.stringify({ variables: { website: 'https://example.com' } }),
  });
  assert(
    blockedApi.response.status === 403 &&
      blockedApi.body?.error?.code === 'BETA_ACCESS_BLOCKED',
    'SUSPENDED_API_RUN_NOT_BLOCKED'
  );
  const exported = await fetch(`${origin}/api/account/export`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
  });
  assert(
    exported.ok && (await exported.text()).includes('betaFeedback'),
    'SUSPENDED_EXPORT_FAILED'
  );
  const operatorAsPro = await fetch(`${origin}/api/internal/beta`, {
    headers: { Cookie: cookie },
  });
  assert(operatorAsPro.status === 404, 'NON_INTERNAL_OPERATOR_ACCESS');

  const restore = await json(`/api/internal/beta/users/${user.id}`, {
    method: 'PATCH',
    headers: operatorHeaders,
    body: JSON.stringify({ state: 'ACTIVE' }),
  });
  assert(restore.response.ok, 'RESTORE_FAILED');
  const revoked = await json(
    `/api/internal/beta/invites/${unused.body.data.id}/revoke`,
    { method: 'POST', headers: operatorHeaders }
  );
  assert(revoked.response.ok, 'INVITE_REVOKE_FAILED');
  const revokedSignup = await json('/api/beta/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inviteToken: unused.body.data.inviteToken,
      email: unusedEmail,
      name: 'Rejected',
      password,
      legalAccepted: true,
    }),
  });
  assert(revokedSignup.response.status === 403, 'REVOKED_INVITE_ACCEPTED');

  console.log(
    JSON.stringify({
      ok: true,
      uninvitedBlocked: true,
      inviteSingleUse: persistedInvite.status === 'ACCEPTED',
      legalAcceptances: user.legalAcceptances.length,
      realRunTerminal: runStatus,
      feedbackVisible: true,
      manualRunBlocked: true,
      scheduleRunBlocked: true,
      apiRunBlocked: true,
      exportAvailable: true,
      reactivated: true,
      revokedBlocked: true,
      capacityBlocked: true,
      nonInternalDenied: true,
    })
  );
} finally {
  const disposable = await prisma.user
    .findUnique({ where: { email }, select: { id: true } })
    .catch(() => null);
  if (disposable)
    await prisma.user
      .delete({ where: { id: disposable.id } })
      .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { email: blockedEmail } })
    .catch(() => undefined);
  await prisma.betaInvite
    .deleteMany({
      where: { email: { in: [email, unusedEmail, overflowEmail] } },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}
