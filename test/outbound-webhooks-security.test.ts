import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  canonicalJson,
  generateSigningSecret,
  protectSigningSecret,
  revealSigningSecret,
  signWebhookBody,
  verifyWebhookSignature,
} from '@/lib/webhooks/crypto';
import { assertWebhookTarget } from '@/lib/webhooks/network';
import { createWebhookEndpointSchema } from '@/lib/webhooks/schemas';

const originalNodeEnv = process.env.NODE_ENV;

describe('Phase 14 webhook target and secret security', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS = 'false';
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64'
    );
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS;
  });

  it('accepts public HTTPS only when every DNS answer is public', async () => {
    await expect(
      assertWebhookTarget('https://hooks.example.com/events', async () => [
        { address: '93.184.216.34', family: 4 },
      ])
    ).resolves.toBe('https://hooks.example.com/events');
  });

  it.each([
    'http://example.com/hook',
    'ftp://example.com/hook',
    'https://user:pass@example.com/hook',
    'https://example.com/hook#fragment',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://2130706433/hook',
    'https://0x7f000001/hook',
  ])('rejects unsafe endpoint %s', async (url) => {
    await expect(assertWebhookTarget(url)).rejects.toMatchObject({
      message: 'Webhook endpoint is not allowed.',
    });
  });

  it('rejects mixed public/private DNS and DNS failures', async () => {
    await expect(
      assertWebhookTarget('https://example.com/hook', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.2', family: 4 },
      ])
    ).rejects.toMatchObject({ code: 'WEBHOOK_PRIVATE_NETWORK_BLOCKED' });
    await expect(
      assertWebhookTarget('https://example.com/hook', async () => {
        throw new Error('dns');
      })
    ).rejects.toMatchObject({ code: 'WEBHOOK_PRIVATE_NETWORK_BLOCKED' });
  });

  it('allows loopback only behind the explicit non-production drill flag', async () => {
    process.env.NODE_ENV = 'development';
    process.env.WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS = 'true';
    await expect(
      assertWebhookTarget('http://127.0.0.1:8787/hook')
    ).resolves.toBe('http://127.0.0.1:8787/hook');
  });

  it('generates a one-time secret and protects it with authenticated encryption', () => {
    const secret = generateSigningSecret();
    const protectedSecret = protectSigningSecret(secret);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(protectedSecret)).not.toContain(secret);
    expect(revealSigningSecret(protectedSecret)).toBe(secret);
    expect(protectedSecret.secretPrefix).toBe(secret.slice(0, 12));
  });

  it('signs the exact deterministic body, event id, and timestamp', () => {
    const body = canonicalJson({ z: 1, data: { b: true, a: 'safe' }, a: 2 });
    expect(body).toBe('{"a":2,"data":{"a":"safe","b":true},"z":1}');
    const first = signWebhookBody({
      secret: 'secret',
      eventId: 'evt_1',
      timestamp: 1,
      rawBody: body,
    });
    const same = signWebhookBody({
      secret: 'secret',
      eventId: 'evt_1',
      timestamp: 1,
      rawBody: body,
    });
    const later = signWebhookBody({
      secret: 'secret',
      eventId: 'evt_1',
      timestamp: 2,
      rawBody: body,
    });
    expect(verifyWebhookSignature(first, same)).toBe(true);
    expect(later).not.toBe(first);
  });

  it('strictly validates supported subscriptions', () => {
    expect(
      createWebhookEndpointSchema.safeParse({
        name: 'prod',
        url: 'https://example.com/hook',
        eventTypes: ['run.succeeded'],
      }).success
    ).toBe(true);
    expect(
      createWebhookEndpointSchema.safeParse({
        name: 'prod',
        url: 'https://example.com/hook',
        eventTypes: ['billing.updated'],
      }).success
    ).toBe(false);
    expect(
      createWebhookEndpointSchema.safeParse({
        name: 'prod',
        url: 'https://example.com/hook',
        eventTypes: ['run.succeeded', 'run.succeeded'],
      }).success
    ).toBe(false);
  });

  it('keeps plaintext out of listing/UI persistence and uses owner-scoped APIs', async () => {
    const service = await readFile(
      'dashboard/src/lib/webhooks/service.ts',
      'utf8'
    );
    const ui = await readFile(
      'dashboard/src/components/dashboard/webhook-management.tsx',
      'utf8'
    );
    const route = await readFile(
      'dashboard/src/app/api/webhooks/[id]/route.ts',
      'utf8'
    );
    expect(service).toContain('where: { id, userId }');
    expect(
      service.slice(
        service.indexOf('function publicEndpoint'),
        service.indexOf('export async function listWebhookEndpoints')
      )
    ).not.toMatch(/secretCiphertext|secretIv|secretTag/);
    expect(ui).not.toMatch(/localStorage|sessionStorage/);
    expect(ui).toContain('It will not be shown again');
    expect(route).toContain('requireAuthenticatedUser');
  });
});
