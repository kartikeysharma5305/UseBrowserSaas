import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  generateApiKeyMaterial,
  hashIdempotencyValue,
  matchesApiKeyHash,
  parseBearerApiKey,
} from '../dashboard/src/lib/public-api/api-keys';
import { API_KEY_SCOPES } from '../dashboard/src/lib/public-api/scopes';
import {
  createApiKeySchema,
  createPublicRunSchema,
  IDEMPOTENCY_KEY_PATTERN,
  publicListQuerySchema,
} from '../dashboard/src/lib/public-api/schemas';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from '../dashboard/src/lib/public-api/resources';
import { PLAN_CATALOGUE } from '../dashboard/src/lib/plans/catalogue';

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf8');

beforeAll(() => {
  process.env.API_KEY_PEPPER =
    'phase13-test-pepper-that-is-longer-than-thirty-two-characters';
});

describe('Phase 13 API-key security', () => {
  it('generates high-entropy recognizable keys and stores a distinct HMAC', () => {
    const first = generateApiKeyMaterial();
    const second = generateApiKeyMaterial();
    expect(first.plaintext).toMatch(
      /^bua_(?:live|test)_[a-f0-9]{16}\.[A-Za-z0-9_-]{40,}$/
    );
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).not.toContain(first.plaintext);
    expect(first.plaintext).not.toBe(second.plaintext);
    expect(matchesApiKeyHash(first.plaintext, first.hash)).toBe(true);
    expect(matchesApiKeyHash(second.plaintext, first.hash)).toBe(false);
  });

  it('accepts one bearer header and rejects malformed/query-string keys', () => {
    const key = generateApiKeyMaterial();
    expect(
      parseBearerApiKey(
        new Request('https://app.test/api/v1/agents', {
          headers: { authorization: `Bearer ${key.plaintext}` },
        })
      )
    ).toEqual({ plaintext: key.plaintext, prefix: key.prefix });
    expect(
      parseBearerApiKey(
        new Request(`https://app.test/api/v1/agents?api_key=${key.plaintext}`)
      )
    ).toBeNull();
    expect(
      parseBearerApiKey(
        new Request('https://app.test/api/v1/agents', {
          headers: { authorization: 'Basic bad' },
        })
      )
    ).toBeNull();
  });

  it('uses a peppered hash for idempotency keys without retaining plaintext', () => {
    expect(hashIdempotencyValue('retry-key-123')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIdempotencyValue('retry-key-123')).not.toContain(
      'retry-key-123'
    );
  });

  it('allows only the six least-privilege scopes', () => {
    expect(API_KEY_SCOPES).toEqual([
      'agents:read',
      'runs:read',
      'runs:create',
      'runs:cancel',
      'results:read',
      'artifacts:read',
    ]);
    expect(
      createApiKeySchema.safeParse({ name: 'Read', scopes: ['billing:write'] })
        .success
    ).toBe(false);
    expect(
      createApiKeySchema.safeParse({ name: 'Read', scopes: ['agents:read'] })
        .success
    ).toBe(true);
  });

  it('rejects expired/out-of-range management input', () => {
    expect(
      createApiKeySchema.safeParse({
        name: 'Expired',
        scopes: ['agents:read'],
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }).success
    ).toBe(false);
    expect(
      createApiKeySchema.safeParse({
        name: 'Too long',
        scopes: ['agents:read'],
        expiresAt: new Date(Date.now() + 400 * 86400000).toISOString(),
      }).success
    ).toBe(false);
  });
});

describe('Phase 13 request contracts', () => {
  it('accepts variables only and rejects client task/model overrides', () => {
    expect(
      createPublicRunSchema.safeParse({ variables: { city: 'Delhi' } }).success
    ).toBe(true);
    expect(
      createPublicRunSchema.safeParse({
        variables: {},
        task: 'override',
        model: 'override',
      }).success
    ).toBe(false);
  });

  it('bounds idempotency and cursor pagination', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test('request-1234')).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('short')).toBe(false);
    expect(publicListQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false
    );
    const cursor = encodeCursor({
      createdAt: new Date(0).toISOString(),
      id: 'run-1',
    });
    expect(decodeCursor(cursor)?.id).toBe('run-1');
    expect(() => decodeCursor('not-json')).toThrow(InvalidCursorError);
  });

  it('keeps per-key limits below aggregate user limits for every plan', () => {
    for (const plan of Object.values(PLAN_CATALOGUE)) {
      expect(plan.limits.apiKeyRequestsPerMinute).toBeLessThan(
        plan.limits.apiUserRequestsPerMinute
      );
      expect(plan.limits.apiRunCreatesPerMinute).toBeLessThanOrEqual(
        plan.limits.apiKeyRequestsPerMinute
      );
    }
  });

  it('uses the ordinary admission/cancellation/artifact/result services', () => {
    expect(read('dashboard/src/lib/public-api/idempotency.ts')).toContain(
      'PrismaAgentExecutionService'
    );
    expect(
      read('dashboard/src/app/api/v1/runs/[id]/cancel/route.ts')
    ).toContain('cancelOwnedRun');
    expect(read('dashboard/src/app/api/v1/artifacts/[id]/route.ts')).toContain(
      'openOwnedArtifact'
    );
    expect(read('dashboard/src/lib/public-api/resources.ts')).not.toContain(
      'structuredRawResult'
    );
    expect(read('dashboard/src/lib/public-api/resources.ts')).not.toContain(
      'structuredCandidate'
    );
  });

  it('requires explicit scopes across every public route', () => {
    const files = [
      'agents/route.ts',
      'agents/[id]/route.ts',
      'agents/[id]/runs/route.ts',
      'runs/route.ts',
      'runs/[id]/route.ts',
      'runs/[id]/cancel/route.ts',
      'runs/[id]/result/route.ts',
      'runs/[id]/artifacts/route.ts',
      'artifacts/[id]/route.ts',
    ];
    for (const file of files)
      expect(read(`dashboard/src/app/api/v1/${file}`)).toContain(
        'authorizePublicApi'
      );
  });

  it('never exposes key hashes or persists plaintext in the UI', () => {
    const keys = read('dashboard/src/lib/public-api/api-keys.ts');
    const ui = read(
      'dashboard/src/components/dashboard/api-key-management.tsx'
    );
    expect(keys.match(/keyHash/g)?.length).toBeGreaterThan(1);
    expect(
      keys.slice(
        keys.indexOf('function publicKey'),
        keys.indexOf('export async function createPersonal')
      )
    ).not.toContain('keyHash');
    expect(ui).not.toMatch(/localStorage|sessionStorage/);
    expect(ui).toContain('shown only once');
  });

  it('revokes keys at the account-deletion request boundary', () => {
    const deletion = read('dashboard/src/lib/account-deletion.ts');
    expect(deletion).toContain('transaction.apiKey.updateMany');
    expect(deletion.indexOf('transaction.apiKey.updateMany')).toBeLessThan(
      deletion.indexOf('return processAccountDeletion')
    );
  });
});
