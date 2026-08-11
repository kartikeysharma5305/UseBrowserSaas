import { validateDeploymentEnvironment } from '../src/lib/deployment/environment';

const config = validateDeploymentEnvironment();
if (config.environment !== 'production')
  throw new Error(
    'Production smoke checks require DEPLOYMENT_ENVIRONMENT=production.'
  );
const token = process.env.OBSERVABILITY_TOKEN!;

async function expectStatus(
  pathname: string,
  status: number,
  authorized = false
) {
  const response = await fetch(`${config.appOrigin}${pathname}`, {
    redirect: 'manual',
    headers: authorized ? { authorization: `Bearer ${token}` } : {},
  });
  if (response.status !== status)
    throw new Error(`${pathname} returned an unexpected status.`);
}

for (const pathname of [
  '/',
  '/login',
  '/privacy',
  '/terms',
  '/acceptable-use',
  '/cookies',
])
  await expectStatus(pathname, 200);
await expectStatus('/api/internal/health', 404);
await expectStatus('/api/internal/metrics', 404);
await expectStatus('/api/internal/health', 200, true);
await expectStatus('/api/internal/readiness', 200, true);
await expectStatus('/api/internal/metrics', 200, true);
console.info(
  JSON.stringify({
    publicPages: 6,
    internalAccessProtected: true,
    health: true,
    readiness: true,
    metrics: true,
  })
);
