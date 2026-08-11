import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createUserDataExport,
  DATA_EXPORT_VERSION,
  DataExportUnavailableError,
} from '../dashboard/src/lib/data-governance/export';
import {
  legalAcceptanceStatus,
  recordCurrentLegalAcceptance,
} from '../dashboard/src/lib/legal/acceptance';
import {
  LEGAL_DOCUMENT_VERSIONS,
  publicLegalConfiguration,
} from '../dashboard/src/lib/legal/config';

const now = new Date('2026-08-10T10:00:00.000Z');

function exportDatabase(overrides: Record<string, unknown> = {}) {
  const delegates: Record<string, any> = {
    accountDeletion: { findUnique: vi.fn().mockResolvedValue(null) },
    betaFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'owner',
        email: 'owner@example.invalid',
        name: 'Owner',
        emailVerified: true,
        image: null,
        planCode: 'PRO',
        planSource: 'MANUAL',
        createdAt: now,
        updatedAt: now,
        notificationPreference: null,
        onboardingState: null,
        subscription: null,
      }),
    },
    agent: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'agent-owner',
          name: 'Owned Agent',
          description: null,
          goal: 'Owned goal',
          targetWebsite: 'https://example.com',
          status: 'ACTIVE',
          configuration: {},
          safetyPolicy: null,
          outputSchema: null,
          createdAt: now,
          updatedAt: now,
          variables: [
            {
              key: 'secret',
              label: 'Secret',
              description: null,
              type: 'SECRET',
              required: false,
              defaultValue: 'must-not-export',
              constraints: null,
              displayOrder: 0,
            },
          ],
        },
      ]),
    },
    run: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'run-owner',
          agentId: 'agent-owner',
          status: 'SUCCESS',
          source: 'MANUAL',
          queuedAt: now,
          startedAt: now,
          completedAt: now,
          duration: 10,
          attempt: 1,
          lastFailureCode: null,
          result: { summary: 'owned result' },
          structuredResult: null,
          structuredStatus: 'NOT_REQUESTED',
          inputSnapshot: null,
          createdAt: now,
          events: [],
          artifacts: [
            {
              id: 'artifact-owner',
              type: 'SCREENSHOT',
              fileName: 'screen.png',
              mimeType: 'image/png',
              size: 3,
              checksum: 'a'.repeat(64),
              createdAt: now,
            },
          ],
        },
      ]),
    },
    schedule: { findMany: vi.fn().mockResolvedValue([]) },
    usageRecord: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'usage-owner',
          runId: 'run-owner',
          attempt: 1,
          type: 'RUN_SUCCEEDED',
          quantity: 1n,
          unit: 'COUNT',
          measurement: 'EXACT',
          recordedAt: now,
          periodStart: now,
          periodEnd: now,
        },
      ]),
    },
    notification: { findMany: vi.fn().mockResolvedValue([]) },
    apiKey: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'key-owner',
          name: 'CLI',
          keyPrefix: 'bua_test_safe',
          scopes: ['runs:read'],
          status: 'ACTIVE',
          expiresAt: null,
          createdAt: now,
          lastUsedAt: null,
          revokedAt: null,
        },
      ]),
    },
    webhookEndpoint: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'webhook-owner',
          name: 'Owned endpoint',
          url: 'https://example.com/hook',
          status: 'ENABLED',
          eventTypes: ['run.completed'],
          secretPrefix: 'whsec_safe',
          createdAt: now,
          updatedAt: now,
          deliveries: [],
        },
      ]),
    },
    legalDocumentAcceptance: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return delegates as any;
}

describe('Phase 25 data export', () => {
  it('exports only owner-scoped portable data with deterministic manifest and redaction', async () => {
    const database = exportDatabase();
    const result = await createUserDataExport('owner', { database, now });
    expect(result.data.manifest.exportVersion).toBe(DATA_EXPORT_VERSION);
    expect(result.data.manifest.generatedAt).toBe(now.toISOString());
    expect(result.data.agents[0].variables[0].defaultValue).toBeNull();
    expect(result.data.usage[0].quantity).toBe('1');
    expect(result.data.runs[0].artifacts[0].downloadPath).toContain(
      '/api/runs/run-owner/artifacts/artifact-owner'
    );
    expect(result.json).not.toContain('must-not-export');
    expect(result.json).not.toContain('secretCiphertext');
    expect(result.json).not.toContain('keyHash');
    expect(result.json).not.toContain('storageKey');
    expect(result.json).not.toContain('"sessions":');
    expect(result.json).not.toContain('"password":');
    expect(database.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner' } })
    );
    expect(database.run.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agent: { userId: 'owner' } } })
    );
  });

  it('blocks export as soon as deletion exists', async () => {
    const database = exportDatabase({
      accountDeletion: {
        findUnique: vi.fn().mockResolvedValue({ status: 'FAILED' }),
      },
    });
    await expect(
      createUserDataExport('owner', { database, now })
    ).rejects.toBeInstanceOf(DataExportUnavailableError);
    expect(database.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('Phase 25 legal acceptance and public contract', () => {
  it('records current versions idempotently and reports them current', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const findMany = vi.fn().mockResolvedValue(
      Object.entries(LEGAL_DOCUMENT_VERSIONS).map(
        ([documentType, documentVersion]) => ({
          documentType,
          documentVersion,
          acceptedAt: now,
        })
      )
    );
    const database = {
      legalDocumentAcceptance: { createMany, findMany },
    } as any;
    const status = await recordCurrentLegalAcceptance(
      'owner',
      ['TERMS', 'TERMS', 'PRIVACY', 'ACCEPTABLE_USE'],
      database
    );
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(status.requiresAcceptance).toBe(false);
  });

  it('detects an obsolete version without changing another user', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { documentType: 'TERMS', documentVersion: 'old', acceptedAt: now },
      ]);
    const status = await legalAcceptanceStatus('owner', {
      legalDocumentAcceptance: { findMany },
    } as any);
    expect(status.requiresAcceptance).toBe(true);
    expect(status.current.TERMS).toBe(false);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner' } })
    );
  });

  it('keeps legal/contact placeholders explicit and links every required surface', async () => {
    expect(publicLegalConfiguration({}).configured).toBe(false);
    const root = path.resolve(import.meta.dirname, '..');
    const files = await Promise.all(
      [
        'dashboard/src/components/auth/auth-forms.tsx',
        'dashboard/src/components/dashboard/privacy-data-card.tsx',
        'dashboard/src/app/page.tsx',
      ].map((file) => fs.readFile(path.join(root, file), 'utf8'))
    );
    for (const href of ['/privacy', '/terms', '/acceptable-use'])
      expect(files.every((source) => source.includes(href))).toBe(true);
    const cookies = await fs.readFile(
      path.join(root, 'dashboard/src/app/cookies/page.tsx'),
      'utf8'
    );
    expect(cookies).toContain('No analytics');
    expect(cookies).not.toContain('marketing consent');
  });
});
