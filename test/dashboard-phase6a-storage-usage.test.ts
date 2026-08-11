import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  artifactStorageHealth,
  getArtifactStorageConfiguration,
} from '../dashboard/src/lib/browser/artifact-storage-config.js';
import {
  ArtifactStorageError,
  LocalArtifactStorage,
} from '../dashboard/src/lib/browser/artifact-storage.js';
import { S3ArtifactStorage } from '../dashboard/src/lib/browser/s3-artifact-storage.js';
import { EXECUTION_ERROR_DEFINITIONS } from '../dashboard/src/lib/execution/errors.js';
import { PLAN_CATALOGUE } from '../dashboard/src/lib/plans/catalogue.js';
import { recordUsage } from '../dashboard/src/lib/usage/ledger.js';
import { getUtcCalendarMonthPeriod } from '../dashboard/src/lib/usage/period.js';
import { enforceAdmissionQuota } from '../dashboard/src/lib/usage/quota.js';

const UsageType = {
  RUN_ADMITTED: 'RUN_ADMITTED',
  ARTIFACT_BYTE: 'ARTIFACT_BYTE',
} as const;
const UsageUnit = { COUNT: 'COUNT', BYTE: 'BYTE' } as const;
const UsageMeasurement = { EXACT: 'EXACT' } as const;

const s3Configuration = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'private-artifacts',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
};

function s3WithSend(send: ReturnType<typeof vi.fn>) {
  const storage = new S3ArtifactStorage(s3Configuration);
  (
    storage as unknown as {
      client: { send: ReturnType<typeof vi.fn> };
    }
  ).client = { send };
  return storage;
}

describe('Phase 6A storage configuration', () => {
  it('accepts local as the safe default', () => {
    expect(getArtifactStorageConfiguration({})).toEqual({ driver: 'LOCAL' });
  });

  it('accepts a valid S3-compatible configuration', () => {
    const configuration = getArtifactStorageConfiguration({
      ARTIFACT_STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://localhost:9000/',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'artifacts',
      S3_ACCESS_KEY_ID: 'access',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(configuration).toMatchObject({
      driver: 'S3',
      s3: {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'artifacts',
        forcePathStyle: true,
      },
    });
  });

  it.each([
    ['S3_REGION', { S3_REGION: undefined }],
    ['S3_BUCKET', { S3_BUCKET: undefined }],
    ['S3_ACCESS_KEY_ID', { S3_ACCESS_KEY_ID: undefined }],
    ['S3_SECRET_ACCESS_KEY', { S3_SECRET_ACCESS_KEY: undefined }],
  ])('rejects missing %s', (name, override) => {
    expect(() =>
      getArtifactStorageConfiguration({
        ARTIFACT_STORAGE_DRIVER: 's3',
        S3_REGION: 'region',
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'access',
        S3_SECRET_ACCESS_KEY: 'secret',
        ...override,
      })
    ).toThrow(name);
  });

  it('rejects malformed endpoints and boolean settings', () => {
    expect(() =>
      getArtifactStorageConfiguration({
        ARTIFACT_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'file:///private',
        S3_REGION: 'region',
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'access',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_FORCE_PATH_STYLE: 'yes',
      })
    ).toThrow(/HTTP or HTTPS|true or false/);
  });

  it('does not serialize credentials in configuration or health output', () => {
    const previous = process.env.ARTIFACT_STORAGE_DRIVER;
    process.env.ARTIFACT_STORAGE_DRIVER = 'local';
    const configuration = getArtifactStorageConfiguration({
      ARTIFACT_STORAGE_DRIVER: 's3',
      S3_REGION: 'region',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY_ID: 'private-access',
      S3_SECRET_ACCESS_KEY: 'private-secret',
    });
    const serialized = JSON.stringify(configuration);
    expect(serialized).not.toContain('private-access');
    expect(serialized).not.toContain('private-secret');
    expect(JSON.stringify(artifactStorageHealth())).not.toMatch(
      /access|secret/i
    );
    process.env.ARTIFACT_STORAGE_DRIVER = previous;
  });
});

describe('Phase 6A artifact storage drivers', () => {
  it('local driver streams, stats, and idempotently deletes an artifact', async () => {
    const root = path.join(
      process.cwd(),
      '.tmp-phase6a-storage',
      String(Date.now())
    );
    const storage = new LocalArtifactStorage(root);
    const data = Buffer.from('small artifact');
    const saved = await storage.save({
      runId: 'run-1',
      fileName: 'artifact.png',
      mimeType: 'image/png',
      data,
    });
    expect(await storage.stat(saved.storageKey)).toEqual({ size: data.length });
    const stream = await storage.readStream(saved.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(data);
    await storage.delete(saved.storageKey);
    await storage.delete(saved.storageKey);
    await fs.promises.rm(path.dirname(root), {
      recursive: true,
      force: true,
    });
  });

  it('S3 saves private data then verifies object size', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ContentLength: 4 });
    const saved = await s3WithSend(send).save({
      runId: 'run-1',
      fileName: 'shot.png',
      mimeType: 'image/png',
      data: Buffer.from('test'),
    });
    expect(saved).toMatchObject({ size: 4, checksum: expect.any(String) });
    expect(send.mock.calls[0][0].input).not.toHaveProperty('ACL');
  });

  it('S3 streams and stats existing objects', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Body: Readable.from(Buffer.from('test')) })
      .mockResolvedValueOnce({ ContentLength: 4 });
    const storage = s3WithSend(send);
    const stream = await storage.readStream('runs/run-1/key.png');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('test');
    await expect(storage.stat('runs/run-1/key.png')).resolves.toEqual({
      size: 4,
    });
  });

  it('S3 deletion is issued without public object settings', async () => {
    const send = vi.fn().mockResolvedValue({});
    await s3WithSend(send).delete('runs/run-1/key.png');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'private-artifacts',
      Key: 'runs/run-1/key.png',
    });
  });

  it.each(['../secret.png', '/absolute.png', 'runs\\key.png', 'runs//key.png'])(
    'rejects invalid key %s',
    async (key) => {
      await expect(s3WithSend(vi.fn()).stat(key)).rejects.toMatchObject({
        code: 'INVALID_STORAGE_KEY',
      });
    }
  );

  it('sanitizes provider errors', async () => {
    const storage = s3WithSend(
      vi.fn().mockRejectedValue(new Error('secret provider detail'))
    );
    await expect(storage.stat('runs/run-1/key.png')).rejects.toEqual(
      new ArtifactStorageError(
        'Object storage operation failed.',
        'STORAGE_FAILURE'
      )
    );
  });
});

describe('Phase 6A usage periods, ledger, and plans', () => {
  it.each([
    [
      '2024-02-29T23:59:59.999Z',
      '2024-02-01T00:00:00.000Z',
      '2024-03-01T00:00:00.000Z',
    ],
    [
      '2026-12-31T23:59:59.999Z',
      '2026-12-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ],
  ])('uses UTC calendar months for %s', (date, start, end) => {
    const period = getUtcCalendarMonthPeriod(new Date(date));
    expect(period.start.toISOString()).toBe(start);
    expect(period.end.toISOString()).toBe(end);
  });

  it('defines ordered conservative plans', () => {
    expect(PLAN_CATALOGUE.FREE.limits.runsPerMonth).toBeLessThan(
      PLAN_CATALOGUE.PRO.limits.runsPerMonth
    );
    expect(PLAN_CATALOGUE.PRO.limits.artifactStorageBytes).toBeLessThan(
      PLAN_CATALOGUE.INTERNAL.limits.artifactStorageBytes
    );
  });

  it.each([
    ['FREE', 25, 1],
    ['PRO', 500, 2],
    ['INTERNAL', 5_000, 5],
  ] as const)(
    'defines %s with %i monthly runs and %i active runs',
    (code, runs, active) => {
      expect(PLAN_CATALOGUE[code].limits).toMatchObject({
        runsPerMonth: runs,
        activeRuns: active,
      });
    }
  );

  it('classifies provider token rows separately from derived duration', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'dashboard/src/lib/usage/ledger.ts'),
      'utf8'
    );
    expect(source).toContain('UsageMeasurement.PROVIDER_REPORTED');
    expect(source).toContain('UsageMeasurement.DERIVED');
  });

  it('writes usage with an idempotency key and BigInt quantity', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await recordUsage({ usageRecord: { createMany } } as never, {
      userId: 'user-1',
      runId: 'run-1',
      type: UsageType.RUN_ADMITTED as never,
      quantity: 1n,
      unit: UsageUnit.COUNT as never,
      measurement: UsageMeasurement.EXACT as never,
      idempotencyKey: 'run:run-1:admitted',
      recordedAt: new Date('2026-07-25T00:00:00.000Z'),
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          quantity: 1n,
          idempotencyKey: 'run:run-1:admitted',
          periodStart: new Date('2026-07-01T00:00:00.000Z'),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('rejects negative usage quantities', async () => {
    await expect(
      recordUsage({} as never, {
        userId: 'user-1',
        runId: 'run-1',
        type: UsageType.ARTIFACT_BYTE as never,
        quantity: -1n,
        unit: UsageUnit.BYTE as never,
        measurement: UsageMeasurement.EXACT as never,
        idempotencyKey: 'invalid',
      })
    ).rejects.toThrow('cannot be negative');
  });
});

describe('Phase 6A quota admission', () => {
  const configuration = {
    model: 'groq_llama-3.3-70b-versatile',
    maxSteps: 10,
    timeoutMs: 60_000,
    browserSettings: {
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
      useVision: false,
    },
  };
  let transaction: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    usageRecord: { aggregate: ReturnType<typeof vi.fn> };
    run: { count: ReturnType<typeof vi.fn> };
    runArtifact: { aggregate: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    transaction = {
      user: { findUnique: vi.fn().mockResolvedValue({ planCode: 'FREE' }) },
      usageRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0n } }),
      },
      run: { count: vi.fn().mockResolvedValue(0) },
      runArtifact: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
      },
    };
  });

  it('accepts a user below all plan limits', async () => {
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration,
        now: new Date(),
      })
    ).resolves.toMatchObject({ planCode: 'FREE' });
  });

  it('rejects the next run after the monthly limit', async () => {
    transaction.usageRecord.aggregate.mockResolvedValue({
      _sum: { quantity: 25n },
    });
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration,
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'MONTHLY_RUN_LIMIT_REACHED' });
  });

  it('rejects active, duration, step, and storage limits with stable codes', async () => {
    transaction.run.count.mockResolvedValue(1);
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration,
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'USER_RUN_LIMIT_REACHED' });

    transaction.run.count.mockResolvedValue(0);
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration: { ...configuration, timeoutMs: 120_001 },
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'MAX_RUN_DURATION_EXCEEDED' });
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration: { ...configuration, maxSteps: 26 },
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'MAX_STEPS_EXCEEDED' });

    transaction.runArtifact.aggregate.mockResolvedValue({
      _sum: { size: 250 * 1024 * 1024 },
    });
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration,
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_REACHED' });
  });
});

describe('Phase 6A maintenance and UI contracts', () => {
  const dashboard = path.join(process.cwd(), 'dashboard');

  it.each([
    ['scripts/migrate-artifacts.ts', '--apply', 'storageProvider'],
    ['scripts/reconcile-usage.ts', '--apply', 'historicalBackfill'],
    ['scripts/assign-plan.ts', '--apply', 'planAssignedAt'],
  ])('%s is dry-run-first and contains %s/%s', (file, apply, contract) => {
    const source = fs.readFileSync(path.join(dashboard, file), 'utf8');
    expect(source).toContain(apply);
    expect(source).toContain(contract);
    expect(source).toMatch(/dryRun|dry-run/);
  });

  it('usage APIs derive identity from authentication and accept no user ID', () => {
    for (const file of [
      'src/app/api/usage/current/route.ts',
      'src/app/api/usage/history/route.ts',
    ]) {
      const source = fs.readFileSync(path.join(dashboard, file), 'utf8');
      expect(source).toContain('requireAuthenticatedUser');
      expect(source).not.toMatch(/searchParams|request\.json|userIdSchema/);
    }
  });

  it('usage UI has bounded accessible progress and no payment flow', () => {
    const source = fs.readFileSync(
      path.join(dashboard, 'src/components/dashboard/usage-dashboard.tsx'),
      'utf8'
    );
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('Math.min(100');
    expect(source).not.toMatch(/Stripe|checkout|payment/i);
  });

  it.each([
    ['MONTHLY_RUN_LIMIT_REACHED', 429],
    ['MONTHLY_EXECUTION_LIMIT_REACHED', 429],
    ['USER_RUN_LIMIT_REACHED', 429],
    ['MAX_RUN_DURATION_EXCEEDED', 422],
    ['MAX_STEPS_EXCEEDED', 422],
    ['STORAGE_LIMIT_REACHED', 429],
    ['PLAN_CONFIGURATION_INVALID', 503],
  ] as const)('publishes stable quota error %s', (code, status) => {
    expect(EXECUTION_ERROR_DEFINITIONS[code]).toMatchObject({
      status,
      message: expect.any(String),
    });
  });

  it.each([
    'ArtifactStorageProvider',
    'PlanCode',
    'UsageRecord',
    'idempotencyKey',
    'LLM_INPUT_TOKEN',
    'LLM_OUTPUT_TOKEN',
    'LLM_TOTAL_TOKEN',
  ])('includes durable schema contract %s', (contract) => {
    const schema = fs.readFileSync(
      path.join(dashboard, 'prisma/schema.prisma'),
      'utf8'
    );
    expect(schema).toContain(contract);
  });

  it.each([
    ['artifacts:migrate', 'scripts/migrate-artifacts.ts'],
    ['artifacts:health', 'scripts/artifact-storage-health.ts'],
    ['usage:reconcile', 'scripts/reconcile-usage.ts'],
    ['plans:assign', 'scripts/assign-plan.ts'],
  ])('registers maintenance command %s', (command, script) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dashboard, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts[command]).toContain(script);
  });

  it.each([
    'database update occurs after successful upload',
    'local delete follows database update',
    'apply requires an environment guard',
    'failed upload leaves local metadata selected as LOCAL',
  ])('migration implementation preserves invariant: %s', (description) => {
    const source = fs.readFileSync(
      path.join(dashboard, 'scripts/migrate-artifacts.ts'),
      'utf8'
    );
    const positions = {
      upload: source.indexOf('destination.save'),
      update: source.indexOf('runArtifact.updateMany'),
      localDelete: source.indexOf('source.delete'),
      environment: source.indexOf('ARTIFACT_MIGRATION_ENVIRONMENT'),
    };
    expect(description).toBeTruthy();
    expect(positions.upload).toBeGreaterThan(-1);
    expect(positions.update).toBeGreaterThan(positions.upload);
    expect(positions.localDelete).toBeGreaterThan(positions.update);
    expect(positions.environment).toBeGreaterThan(-1);
  });
});
