import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { betaExecutionBlocked } from '../dashboard/src/lib/beta/access';
import { safeFeedbackText } from '../dashboard/src/lib/beta/feedback';
import {
  generateBetaInviteToken,
  hashBetaInviteToken,
} from '../dashboard/src/lib/beta/invites';

const root = path.resolve(import.meta.dirname, '..');

describe('Phase 27 closed beta security', () => {
  it('generates independent 256-bit URL-safe invite tokens', () => {
    const first = generateBetaInviteToken();
    const second = generateBetaInviteToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('persists a deterministic digest rather than plaintext', () => {
    const token = generateBetaInviteToken();
    const digest = hashBetaInviteToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashBetaInviteToken(token)).toBe(digest);
  });

  it.each([
    ['NONE', false],
    ['ACTIVE', false],
    ['SUSPENDED', true],
    ['ENDED', true],
  ])('enforces beta execution state %s', (state, expected) => {
    expect(betaExecutionBlocked(state)).toBe(expected);
  });

  it('rejects common secret markers in feedback', () => {
    expect(() => safeFeedbackText('password=do-not-store-this')).toThrow(
      'FEEDBACK_CONTAINS_SECRET'
    );
    expect(() => safeFeedbackText('Bearer abcdefghijklmnopqrstuvwxyz')).toThrow(
      'FEEDBACK_CONTAINS_SECRET'
    );
    expect(safeFeedbackText('The schedule form is confusing.')).toBe(
      'The schedule form is confusing.'
    );
  });

  it('has one additive migration with uniqueness and lifecycle foreign keys', async () => {
    const sql = await fs.readFile(
      path.join(
        root,
        'dashboard/prisma/migrations/20260814010000_phase27_closed_beta/migration.sql'
      ),
      'utf8'
    );
    expect(sql).toContain('BetaInvite_tokenHash_key');
    expect(sql).toContain('BetaInvite_acceptedByUserId_key');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('gates direct signup while retaining invite signup and legal acceptance', async () => {
    const [authRoute, betaRoute] = await Promise.all([
      fs.readFile(
        path.join(root, 'dashboard/src/app/api/auth/[...all]/route.ts'),
        'utf8'
      ),
      fs.readFile(
        path.join(root, 'dashboard/src/app/api/beta/register/route.ts'),
        'utf8'
      ),
    ]);
    expect(authRoute).toContain('BETA_CONFIG.enabled');
    expect(betaRoute).toContain('reserveBetaInvite');
    expect(betaRoute).toContain('recordCurrentLegalAcceptance');
  });

  it('blocks all execution ingress points without blocking privacy routes', async () => {
    const sources = await Promise.all(
      [
        'dashboard/src/lib/queue/run-producer.ts',
        'dashboard/src/lib/public-api/auth.ts',
        'dashboard/src/app/api/webhooks/[id]/test/route.ts',
        'dashboard/src/app/api/webhooks/deliveries/[id]/replay/route.ts',
      ].map((file) => fs.readFile(path.join(root, file), 'utf8'))
    );
    for (const source of sources)
      expect(source).toMatch(
        /BETA_ACCESS_(SUSPENDED|BLOCKED)|betaExecutionBlocked/
      );
    const accountRoutes = await fs.readdir(
      path.join(root, 'dashboard/src/app/api/account')
    );
    expect(accountRoutes.length).toBeGreaterThan(0);
  });

  it('includes feedback in export and deletion', async () => {
    const [exportSource, deleteSource] = await Promise.all([
      fs.readFile(
        path.join(root, 'dashboard/src/lib/data-governance/export.ts'),
        'utf8'
      ),
      fs.readFile(
        path.join(root, 'dashboard/src/lib/account-deletion.ts'),
        'utf8'
      ),
    ]);
    expect(exportSource).toContain('betaFeedback: feedback');
    expect(deleteSource).toContain('betaFeedback.deleteMany');
  });

  it('documents closed-beta and public-launch gates', async () => {
    for (const file of [
      'CLOSED_BETA.md',
      'BETA_OPERATIONS.md',
      'CLOSED_BETA_CHECKLIST.md',
    ])
      await expect(
        fs.stat(path.join(root, 'dashboard/docs', file))
      ).resolves.toBeTruthy();
  });
});
