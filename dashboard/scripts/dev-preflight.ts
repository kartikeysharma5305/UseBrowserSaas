import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import {
  artifactStorageHealth,
  getArtifactStorageConfiguration,
} from '../src/lib/browser/artifact-storage-config';
import { resolveArtifactStorageRoot } from '../src/lib/browser/artifact-storage';

const dashboardRoot = process.cwd();
const repositoryRoot = path.resolve(dashboardRoot, '..');
let currentCheck = 'configuration';

function loadOptionalEnvironment(fileName: string): boolean {
  const target = path.join(dashboardRoot, fileName);
  if (!existsSync(target)) return false;
  process.loadEnvFile(target);
  return true;
}

function runPnpm(args: string[], failureMessage: string): string {
  const pnpmScript = process.env.npm_execpath;
  const command = pnpmScript ? process.execPath : 'pnpm';
  const commandArgs = pnpmScript ? [pnpmScript, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: dashboardRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-8)
      .join('\n');
    fail(output ? `${failureMessage}\n${output}` : failureMessage);
  }
  return result.stdout.trim();
}

function fail(message: string): never {
  throw new Error(message);
}

function pass(message: string): void {
  console.log(`[preflight] OK ${message}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function validatedUrl(
  name: string,
  value: string,
  protocols: readonly string[]
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(url.protocol)) {
    fail(`${name} must use ${protocols.join(' or ')}.`);
  }
  return url;
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Dashboard port ${port} is already in use.`
            : `Dashboard port ${port} could not be checked.`
        )
      );
    });
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close((error) =>
        error
          ? reject(new Error(`Dashboard port ${port} could not be released.`))
          : resolve()
      );
    });
  });
}

async function checkPostgres(): Promise<void> {
  const client = new PrismaClient({ log: [] });
  try {
    await client.$queryRaw`SELECT 1`;
  } catch {
    fail('PostgreSQL is unavailable at the configured DATABASE_URL.');
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

async function checkRedis(redisUrl: string): Promise<void> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    if ((await client.ping()) !== 'PONG')
      fail('Redis did not respond to PING.');
  } catch {
    fail('Redis is unavailable at the configured REDIS_URL.');
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

async function checkArtifactStorage(): Promise<void> {
  const configuration = getArtifactStorageConfiguration();
  const maxBytes = process.env.ARTIFACT_MAX_BYTES_PER_RUN;
  if (maxBytes) {
    const parsed = Number(maxBytes);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      fail('ARTIFACT_MAX_BYTES_PER_RUN must be a positive integer.');
    }
  }
  if (configuration.driver === 'S3') {
    const s3 = configuration.s3!;
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
      fail(
        'S3 artifact storage is configured but the private bucket is unavailable.'
      );
    } finally {
      client.destroy();
    }
  } else {
    try {
      mkdirSync(resolveArtifactStorageRoot(), { recursive: true, mode: 0o700 });
    } catch {
      fail('Local artifact storage root is not writable.');
    }
  }
  pass(`Artifact storage: ${artifactStorageHealth().driver}`);
}

async function main(): Promise<void> {
  const localEnvironmentLoaded = loadOptionalEnvironment('.env.local');
  const sharedEnvironmentLoaded = loadOptionalEnvironment('.env');
  if (!localEnvironmentLoaded && !sharedEnvironmentLoaded) {
    pass('Environment supplied by the parent process');
  } else {
    pass(
      `Dashboard environment loaded (${localEnvironmentLoaded ? '.env.local' : '.env'})`
    );
  }

  currentCheck = 'Node.js';
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 20) {
    fail('Node.js 20 or newer is required for local development.');
  }
  pass(`Node.js ${process.versions.node}`);

  currentCheck = 'pnpm';
  const pnpmScript = process.env.npm_execpath;
  const pnpm = spawnSync(
    pnpmScript ? process.execPath : 'pnpm',
    pnpmScript ? [pnpmScript, '--version'] : ['--version'],
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }
  );
  if (pnpm.status !== 0) fail('pnpm is not available on PATH.');
  pass(`pnpm ${pnpm.stdout.trim()}`);

  currentCheck = 'root engine';
  for (const relativePath of ['package.json', 'tsconfig.json', 'src']) {
    if (!existsSync(path.join(repositoryRoot, relativePath))) {
      fail('Root engine build prerequisites are incomplete.');
    }
  }
  pass('Root engine build prerequisites available');

  currentCheck = 'environment';
  const databaseUrl = validatedUrl('DATABASE_URL', required('DATABASE_URL'), [
    'postgres:',
    'postgresql:',
  ]);
  const redisUrl = validatedUrl('REDIS_URL', required('REDIS_URL'), [
    'redis:',
    'rediss:',
  ]);
  required('GROQ_API_KEY');
  required('BETTER_AUTH_SECRET');
  const apiKeyPepper = required('API_KEY_PEPPER');
  if (apiKeyPepper.length < 32) {
    fail('API_KEY_PEPPER must contain at least 32 characters.');
  }
  const webhookEncryptionKey = Buffer.from(
    required('WEBHOOK_SECRET_ENCRYPTION_KEY'),
    'base64'
  );
  if (webhookEncryptionKey.length !== 32) {
    fail('WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  const trustedOrigins = required('BETTER_AUTH_TRUSTED_ORIGINS');
  const authUrl = validatedUrl('BETTER_AUTH_URL', required('BETTER_AUTH_URL'), [
    'http:',
    'https:',
  ]);
  if (
    Number(authUrl.port || (authUrl.protocol === 'https:' ? 443 : 80)) !== 3001
  ) {
    fail('BETTER_AUTH_URL must use the dashboard development port 3001.');
  }
  if (
    !trustedOrigins
      .split(',')
      .map((origin) => origin.trim())
      .includes(authUrl.origin)
  ) {
    fail('BETTER_AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL origin.');
  }
  pass('Required server configuration present');
  pass('Groq key configured');

  currentCheck = 'Prisma schema';
  if (!existsSync(path.join(dashboardRoot, 'prisma', 'schema.prisma'))) {
    fail('Prisma schema is missing.');
  }
  runPnpm(['exec', 'prisma', 'validate'], 'Prisma schema validation failed.');
  pass('Prisma schema valid');

  currentCheck = 'Prisma client';
  runPnpm(['exec', 'prisma', 'generate'], 'Prisma client generation failed.');
  pass('Prisma client generated');

  currentCheck = 'artifact storage';
  await checkArtifactStorage();

  currentCheck = 'PostgreSQL';
  void databaseUrl;
  await checkPostgres();
  pass('PostgreSQL reachable');

  currentCheck = 'Redis';
  await checkRedis(redisUrl.href);
  pass('Redis reachable');

  currentCheck = 'dashboard port';
  await assertPortAvailable(3001);
  pass('Dashboard port 3001 available');
}

try {
  await main();
  console.log('[preflight] READY Local dependencies are ready.');
} catch (error) {
  const message =
    error instanceof Error ? error.message : `${currentCheck} check failed.`;
  console.error(`[preflight] ERROR ${message}`);
  process.exitCode = 1;
}
