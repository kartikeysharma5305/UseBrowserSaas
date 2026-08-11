import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { persistScreenshotCandidates } from '../dashboard/src/lib/browser/artifact-persistence.js';
import { PLAN_CATALOGUE } from '../dashboard/src/lib/plans/catalogue.js';
import {
  createRunCostBudget,
  parseRunCostBudget,
} from '../dashboard/src/lib/usage/cost-policy.js';
import { recordUsage } from '../dashboard/src/lib/usage/ledger.js';
import { enforceAdmissionQuota } from '../dashboard/src/lib/usage/quota.js';

const configuration = {
  model: 'groq_llama-3.3-70b-versatile',
  maxSteps: 25,
  timeoutMs: 60_000,
  browserSettings: {
    headless: true,
    viewportWidth: 1280,
    viewportHeight: 720,
    useVision: false,
  },
};

describe('Phase 21 centralized cost policy', () => {
  it('captures immutable plan and execution ceilings without monetary estimates', () => {
    const admittedAt = new Date('2026-08-11T01:00:00Z');
    const snapshot = createRunCostBudget(
      PLAN_CATALOGUE.FREE,
      configuration,
      admittedAt
    );
    expect(snapshot).toMatchObject({
      version: 1,
      planCode: 'FREE',
      timeoutMs: 60_000,
      maxSteps: 25,
      maxArtifacts: 10,
      admittedAt: admittedAt.toISOString(),
    });
    expect(parseRunCostBudget(snapshot)).toEqual(snapshot);
    expect(parseRunCostBudget({ ...snapshot, timeoutMs: -1 })).toBeNull();
    expect(snapshot).not.toHaveProperty('price');
    expect(snapshot).not.toHaveProperty('estimatedCost');
  });

  it('keeps product quotas, security limits, and cost budgets distinct', () => {
    for (const plan of Object.values(PLAN_CATALOGUE)) {
      expect(plan.limits.runsPerMonth).toBeGreaterThan(0);
      expect(plan.limits.apiRunCreatesPerMinute).toBeGreaterThan(0);
      expect(plan.limits.executionMsPerMonth).toBeGreaterThan(
        plan.limits.maxRunDurationMs
      );
      expect(plan.limits.maxArtifactBytesPerRun).toBeLessThanOrEqual(
        Number(plan.limits.artifactStorageBytes)
      );
      expect(plan.limits.maxArtifactsPerRun).toBeGreaterThan(0);
    }
    expect(PLAN_CATALOGUE.PRO.limits.maxRunDurationMs).toBeGreaterThanOrEqual(
      300_000
    );
  });
});

describe('Phase 21 durable admission and accounting', () => {
  it('rejects a Run whose reserved timeout exceeds remaining monthly execution', async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({ _sum: { quantity: 0n } })
      .mockResolvedValueOnce({ _sum: { quantity: 1_750_001n } });
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue({ planCode: 'FREE' }) },
      usageRecord: { aggregate },
      run: { count: vi.fn().mockResolvedValue(0) },
      runArtifact: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
      },
    };
    await expect(
      enforceAdmissionQuota(transaction as never, {
        userId: 'user-1',
        configuration,
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'MONTHLY_EXECUTION_LIMIT_REACHED' });
    expect(transaction.run.count).not.toHaveBeenCalled();
  });

  it('writes through the existing idempotent Usage ledger', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await recordUsage({ usageRecord: { createMany } } as never, {
      userId: 'user-1',
      runId: 'run-1',
      type: 'EXECUTION_MILLISECOND',
      quantity: 1000n,
      unit: 'MILLISECOND',
      measurement: 'DERIVED',
      idempotencyKey: 'run:run-1:attempt:1:execution-ms',
    });
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });

  it('persists immutable configuration and budget before queueing', () => {
    const producer = fs.readFileSync(
      'dashboard/src/lib/queue/run-producer.ts',
      'utf8'
    );
    const worker = fs.readFileSync(
      'dashboard/src/lib/worker/browser-run-processor.ts',
      'utf8'
    );
    expect(producer).toContain('executionConfiguration:');
    expect(producer).toContain('costBudget:');
    expect(worker).toMatch(
      /claimed\.executionConfiguration\s*\?\?\s*claimed\.agent\.configuration/
    );
    expect(worker).toContain('parseRunCostBudget(claimed.costBudget)');
    expect(worker).toContain('costBudget.timeoutMs');
    expect(worker).toContain('costBudget.maxSteps');
  });
});

describe('Phase 21 artifact economics', () => {
  it('enforces the per-Run screenshot count before further storage writes', async () => {
    const save = vi.fn(async (input: { data: Buffer; fileName: string }) => ({
      storageKey: input.fileName,
      checksum: 'checksum',
      fileName: input.fileName,
      mimeType: 'image/png' as const,
      size: input.data.length,
    }));
    const png = (suffix: string) =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(suffix),
      ]).toString('base64');
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      ['one', 'two', 'three'].map((suffix, index) => ({
        kind: 'base64' as const,
        value: png(suffix),
        mimeType: 'image/png' as const,
        stepNumber: index + 1,
        eventSequence: index + 2,
      })),
      { provider: 'LOCAL', save, read: vi.fn(), delete: vi.fn() },
      1024,
      2
    );
    expect(artifacts).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('Phase 21 shared-source and UI contracts', () => {
  it('routes schedule, API, template, and dashboard execution through one admission service', () => {
    for (const file of [
      'dashboard/src/lib/scheduling/processor.ts',
      'dashboard/src/lib/public-api/idempotency.ts',
      'dashboard/src/lib/templates/service.ts',
      'dashboard/src/app/api/agents/[id]/run/route.ts',
    ]) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toMatch(/PrismaRunProducer|PrismaAgentExecutionService/);
    }
  });

  it('shows monthly execution consumption separately from per-Run maximums', () => {
    const ui = fs.readFileSync(
      'dashboard/src/components/dashboard/usage-dashboard.tsx',
      'utf8'
    );
    expect(ui).toContain('Execution time');
    expect(ui).toContain('Per Run maximums');
    expect(ui).toContain('approaching a current-period limit');
    expect(ui).toContain('not monetary estimates');
    expect(ui).not.toMatch(/\$\d|provider pricing|cost per token/i);
  });
});
