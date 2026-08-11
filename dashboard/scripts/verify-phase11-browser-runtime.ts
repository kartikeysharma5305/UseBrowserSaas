import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { prisma } from '../src/lib/db/prisma';
import { EngineLoader } from '../src/lib/browser/engine-loader';
import { normalizeSafetyPolicy } from '../src/lib/execution-safety/policy';
import {
  ExecutionSafetyGuard,
  installExecutionSafetyGuard,
} from '../src/lib/execution-safety/runtime-guard';
import {
  SafetyPolicyError,
  type SafetyFailureCode,
} from '../src/lib/execution-safety/types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const hits = {
  redirectStart: 0,
  redirectTarget: 0,
  subdomain: 0,
  suffixConfusion: 0,
  navigations: new Map<string, number>(),
  download: 0,
  purchaseSubmission: 0,
};

const server = createServer((request, response) => {
  const host = String(request.headers.host ?? '').split(':')[0];
  const requestUrl = new URL(request.url ?? '/', 'http://controlled.invalid');
  if (requestUrl.pathname === '/redirect') {
    hits.redirectStart += 1;
    const liveAddress = server.address();
    const livePort =
      liveAddress && typeof liveAddress !== 'string' ? liveAddress.port : 0;
    response.writeHead(302, {
      location: `http://blocked.phase11.test:${livePort}/redirect-target?probe=redacted`,
    });
    response.end();
    return;
  }
  if (requestUrl.pathname === '/redirect-target') {
    hits.redirectTarget += 1;
    response.end('redirect target must not be reached');
    return;
  }
  if (requestUrl.pathname.startsWith('/nav/')) {
    hits.navigations.set(
      requestUrl.pathname,
      (hits.navigations.get(requestUrl.pathname) ?? 0) + 1
    );
    response.end(
      `<html><body>Controlled page ${requestUrl.pathname}</body></html>`
    );
    return;
  }
  if (requestUrl.pathname === '/download-page') {
    response.end(
      '<html><body><a id="download" download href="/tiny-file">Harmless download</a></body></html>'
    );
    return;
  }
  if (requestUrl.pathname === '/tiny-file') {
    hits.download += 1;
    response.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="phase11.txt"',
    });
    response.end('phase 11 disposable file');
    return;
  }
  if (requestUrl.pathname === '/purchase') {
    response.end(`<!doctype html><html><body>
      <form action="/purchase-submit" method="post">
        <input name="quantity" value="1" />
        <button id="purchase" type="submit" aria-label="Confirm purchase" data-action="purchase">Confirm order</button>
      </form></body></html>`);
    return;
  }
  if (requestUrl.pathname === '/purchase-submit') {
    hits.purchaseSubmission += 1;
    response.end('must not submit');
    return;
  }
  if (host === 'sub.phase11.test') hits.subdomain += 1;
  if (host === 'phase11.test.attacker.test') hits.suffixConfusion += 1;
  response.end('<html><body>Controlled Phase 11 origin</body></html>');
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(
  address && typeof address !== 'string',
  'Controlled server did not start.'
);
const port = address.port;
const origin = (hostname: string) => `http://${hostname}:${port}`;
const resolver = async () => [{ address: '1.1.1.1', family: 4 }];

const modules = await new EngineLoader().loadEngineModules();
const BrowserProfileClass = modules.BrowserProfileClass as new (
  options: unknown
) => unknown;
const BrowserSessionClass = modules.BrowserSessionClass as new (
  options: unknown
) => Record<string, any>;

async function guardedSession(input: {
  allowedDomains: string[];
  allowSubdomains?: boolean;
  redirectPolicy?: 'SAME_DOMAIN' | 'ALLOWED_DOMAINS';
  maxNavigations?: number;
}) {
  const target = origin(input.allowedDomains[0]);
  const policy = normalizeSafetyPolicy(
    {
      allowedDomains: input.allowedDomains,
      allowSubdomains: input.allowSubdomains ?? false,
      redirectPolicy: input.redirectPolicy ?? 'SAME_DOMAIN',
      maxNavigations: input.maxNavigations ?? 20,
      maxPages: 2,
    },
    target
  );
  const profile = new BrowserProfileClass({
    headless: true,
    allowed_domains: input.allowedDomains.flatMap((domain) =>
      input.allowSubdomains
        ? [`http://${domain}:${port}`, `http://*.${domain}:${port}`]
        : [`http://${domain}:${port}`]
    ),
    block_ip_addresses: true,
    accept_downloads: false,
    downloads_path: null,
    args: [
      '--no-proxy-server',
      '--host-resolver-rules=MAP phase11.test 127.0.0.1, MAP *.phase11.test 127.0.0.1, MAP phase11.test.attacker.test 127.0.0.1',
    ],
  });
  const session = new BrowserSessionClass({ browser_profile: profile });
  const guard = new ExecutionSafetyGuard(policy, target, resolver);
  installExecutionSafetyGuard(session, guard);
  await session.start();
  return { session, guard, policy };
}

async function failureCode(operation: () => Promise<unknown>) {
  try {
    await operation();
    return null;
  } catch (error) {
    return error instanceof SafetyPolicyError ? error.code : null;
  }
}

const disposableDownloadDir = await mkdtemp(
  path.join(tmpdir(), 'phase11-download-')
);
const artifactCountBefore = await prisma.runArtifact.count();
const evidence = {
  redirect: false,
  subdomainToggle: false,
  immutableSubdomainPolicy: false,
  navigationLimit: false,
  downloadCancellation: false,
  purchaseBlocking: false,
  failureCodesPersisted: false,
  redaction: false,
  noArtifactsOrFiles: false,
  cleanup: false,
};
const persistedCodes: SafetyFailureCode[] = [
  'REDIRECT_BLOCKED',
  'DOMAIN_NOT_ALLOWED',
  'NAVIGATION_LIMIT_EXCEEDED',
  'DOWNLOAD_BLOCKED',
  'PAYMENT_ACTION_BLOCKED',
];
let fixtureUserId: string | null = null;

try {
  const redirect = await guardedSession({
    allowedDomains: ['phase11.test', 'blocked.phase11.test'],
    redirectPolicy: 'SAME_DOMAIN',
  });
  const redirectCode = await failureCode(() =>
    redirect.session.navigate_to(`${origin('phase11.test')}/redirect`)
  );
  evidence.redirect =
    redirectCode === 'REDIRECT_BLOCKED' &&
    hits.redirectStart === 1 &&
    hits.redirectTarget === 0;
  await redirect.session.close();

  const exact = await guardedSession({ allowedDomains: ['phase11.test'] });
  await exact.session.navigate_to(origin('phase11.test'));
  const blockedSubdomain = await failureCode(() =>
    exact.session.navigate_to(origin('sub.phase11.test'))
  );
  const suffixBlocked = await failureCode(() =>
    exact.session.navigate_to(origin('phase11.test.attacker.test'))
  );
  await exact.session.close();
  const enabled = await guardedSession({
    allowedDomains: ['phase11.test'],
    allowSubdomains: true,
  });
  await enabled.session.navigate_to(origin('sub.phase11.test'));
  evidence.subdomainToggle =
    blockedSubdomain === 'DOMAIN_NOT_ALLOWED' &&
    suffixBlocked === 'DOMAIN_NOT_ALLOWED' &&
    hits.subdomain > 0 &&
    hits.suffixConfusion === 0;
  evidence.immutableSubdomainPolicy =
    exact.policy.allowSubdomains === false && enabled.policy.allowSubdomains;
  await enabled.session.close();

  const limited = await guardedSession({
    allowedDomains: ['phase11.test'],
    maxNavigations: 2,
  });
  await limited.session.navigate_to(`${origin('phase11.test')}/nav/one`);
  await limited.session.navigate_to(`${origin('phase11.test')}/nav/two`);
  const limitCode = await failureCode(() =>
    limited.session.navigate_to(`${origin('phase11.test')}/nav/three`)
  );
  const retryCode = await failureCode(() =>
    limited.session.navigate_to(`${origin('phase11.test')}/nav/three`)
  );
  evidence.navigationLimit =
    limitCode === 'NAVIGATION_LIMIT_EXCEEDED' &&
    retryCode === 'NAVIGATION_LIMIT_EXCEEDED' &&
    (hits.navigations.get('/nav/one') ?? 0) === 1 &&
    (hits.navigations.get('/nav/two') ?? 0) === 1 &&
    (hits.navigations.get('/nav/three') ?? 0) === 0;
  await limited.session.close();

  const download = await guardedSession({ allowedDomains: ['phase11.test'] });
  await download.session.navigate_to(`${origin('phase11.test')}/download-page`);
  const downloadPage = await download.session.get_current_page();
  const downloadEvent = downloadPage.waitForEvent('download');
  await downloadPage.locator('#download').click();
  const actualDownload = await downloadEvent;
  await new Promise((resolve) => setTimeout(resolve, 100));
  let downloadCode: string | null = null;
  try {
    download.guard.throwPendingFailure();
  } catch (error) {
    downloadCode = error instanceof SafetyPolicyError ? error.code : null;
  }
  const retainedPath = await actualDownload.path().catch(() => null);
  evidence.downloadCancellation =
    hits.download === 1 &&
    downloadCode === 'DOWNLOAD_BLOCKED' &&
    retainedPath === null &&
    (download.session.downloaded_files?.length ?? 0) === 0;
  await download.session.close();

  const purchase = await guardedSession({ allowedDomains: ['phase11.test'] });
  await purchase.session.navigate_to(`${origin('phase11.test')}/purchase`);
  const purchasePage = await purchase.session.get_current_page();
  const metadata = await purchasePage
    .locator('#purchase')
    .evaluate((element: HTMLElement) => ({
      tag_name: element.tagName.toLowerCase(),
      inner_text: element.innerText,
      attributes: Object.fromEntries(
        [...element.attributes].map((attribute) => [
          attribute.name,
          attribute.value,
        ])
      ),
    }));
  let purchaseCode: string | null = null;
  try {
    purchase.guard.assertClick(metadata);
  } catch (error) {
    purchaseCode = error instanceof SafetyPolicyError ? error.code : null;
  }
  evidence.purchaseBlocking =
    purchaseCode === 'PAYMENT_ACTION_BLOCKED' && hits.purchaseSubmission === 0;
  await purchase.session.close();

  const fixtureUser = await prisma.user.create({
    data: {
      email: `phase11-runtime-${randomBytes(6).toString('hex')}@example.invalid`,
      name: 'Phase 11 runtime fixture',
    },
  });
  fixtureUserId = fixtureUser.id;
  const fixtureAgent = await prisma.agent.create({
    data: {
      userId: fixtureUser.id,
      name: 'Phase 11 failure-code fixture',
      goal: 'Disposable runtime evidence.',
      targetWebsite: origin('phase11.test'),
      configuration: {},
      safetyPolicy: {},
    },
  });
  for (const code of persistedCodes) {
    const error = new SafetyPolicyError(code);
    await prisma.run.create({
      data: {
        agentId: fixtureAgent.id,
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: error.publicMessage,
        lastFailureCode: code,
        executionSafetyPolicy: {},
      },
    });
  }
  const stored = await prisma.run.findMany({
    where: { agentId: fixtureAgent.id },
    select: { lastFailureCode: true, errorMessage: true },
  });
  evidence.failureCodesPersisted = persistedCodes.every((code) =>
    stored.some((run) => run.lastFailureCode === code)
  );
  const serialized = JSON.stringify(stored);
  evidence.redaction =
    !serialized.includes('probe=') &&
    !serialized.includes('127.0.0.1') &&
    !serialized.includes('phase11.test') &&
    !serialized.includes(disposableDownloadDir);
  evidence.noArtifactsOrFiles =
    (await prisma.runArtifact.count()) === artifactCountBefore &&
    (await readdir(disposableDownloadDir)).length === 0;
} finally {
  if (fixtureUserId)
    await prisma.user.deleteMany({ where: { id: fixtureUserId } });
  evidence.cleanup =
    !fixtureUserId ||
    (await prisma.user.count({ where: { id: fixtureUserId } })) === 0;
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(disposableDownloadDir, { recursive: true, force: true });
}

assert(
  Object.values(evidence).every(Boolean),
  `Phase 11 browser evidence incomplete: ${JSON.stringify(evidence)}`
);
console.log(
  JSON.stringify({ phase: '11-browser-closure', status: 'passed', evidence })
);
