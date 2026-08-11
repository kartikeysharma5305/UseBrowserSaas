import { spawnSync } from 'node:child_process';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';

import { buildSecurityHeaders } from '../next.config';
import { getAuthCookiePolicy } from '../src/lib/auth/cookie-policy';
import { getArtifactStorageConfiguration } from '../src/lib/browser/artifact-storage-config';
import {
  DeploymentConfigurationError,
  validateDeploymentEnvironment,
} from '../src/lib/deployment/environment';
import { getQueueConfiguration } from '../src/lib/queue/config';

const configOnly = process.argv.includes('--config-only');

function pass(message: string) {
  console.info(`[production-preflight] OK ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function runPrismaStatus() {
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath!, 'exec', 'prisma', 'migrate', 'status'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    }
  );
  if (result.status !== 0)
    fail('Prisma migration status is not current or could not be checked.');
}

async function liveChecks(databaseUrl: string, redisUrl: string) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    fail('PostgreSQL is unavailable.');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
  pass('PostgreSQL reachable');

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    if ((await redis.ping()) !== 'PONG') fail('Redis did not respond to PING.');
    const version = (await redis.info('server')).match(
      /redis_version:([^\r\n]+)/
    )?.[1];
    if (!version) fail('Redis version could not be determined.');
    const [major, minor] = version.split('.').map(Number);
    if (major < 6 || (major === 6 && minor < 2))
      fail(
        'Redis 6.2 or newer is required for production BullMQ compatibility.'
      );
    const policyResult = (await redis.config(
      'GET',
      'maxmemory-policy'
    )) as string[];
    const policy = policyResult[1];
    if (policy && policy !== 'noeviction')
      fail('Redis maxmemory-policy must be noeviction for BullMQ.');
    pass(`Redis ${major}.${minor} reachable with noeviction policy`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Redis '))
      throw error;
    fail(
      'Redis is unavailable or its production policy could not be verified.'
    );
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }

  runPrismaStatus();
  pass('Prisma migrations current');

  const storage = getArtifactStorageConfiguration();
  if (storage.driver === 'S3') {
    const s3 = storage.s3!;
    const client = new S3Client({
      region: s3.region,
      ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
      forcePathStyle: s3.forcePathStyle,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
    } catch {
      fail('Configured private S3 artifact bucket is unavailable.');
    } finally {
      client.destroy();
    }
    pass('Private S3 artifact bucket reachable');
  } else pass('Local artifact storage configured (host-bound warning applies)');
}

try {
  const config = validateDeploymentEnvironment();
  const csp = buildSecurityHeaders(true).find(
    (header) => header.key === 'Content-Security-Policy'
  )?.value;
  if (!csp || csp.includes("'unsafe-eval'"))
    fail('Production CSP is missing or contains unsafe-eval.');
  if (!getAuthCookiePolicy(true).defaultCookieAttributes.secure)
    fail('Production authentication cookies are not Secure.');
  getQueueConfiguration();
  pass(
    `${config.environment}/${config.instanceId} configuration valid; CSP and Secure cookies enforced`
  );
  for (const warning of config.warnings)
    console.warn(`[production-preflight] WARN ${warning}`);
  if (!configOnly) await liveChecks(config.databaseUrl, config.redisUrl);
  console.info(
    `[production-preflight] READY ${configOnly ? 'Configuration' : 'Deployment dependencies'} verified.`
  );
} catch (error) {
  const message =
    error instanceof DeploymentConfigurationError || error instanceof Error
      ? error.message
      : 'Production preflight failed.';
  console.error(`[production-preflight] ERROR ${message}`);
  process.exitCode = 1;
}
