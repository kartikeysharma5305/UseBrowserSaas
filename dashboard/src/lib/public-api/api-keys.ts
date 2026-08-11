import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ApiKey, User } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { API_KEY_SCOPES, type ApiKeyScope } from './scopes';
const API_KEY_PATTERN =
  /^(bua_(?:live|test)_[a-f0-9]{16})\.([A-Za-z0-9_-]{40,})$/;

function pepper(): string {
  const value = process.env.API_KEY_PEPPER?.trim();
  if (!value || value.length < 32)
    throw new Error('API_KEY_PEPPER must contain at least 32 characters.');
  return value;
}

function digest(value: string): string {
  return createHmac('sha256', pepper()).update(value, 'utf8').digest('hex');
}

export function generateApiKeyMaterial() {
  const prefix = `bua_${process.env.NODE_ENV === 'production' ? 'live' : 'test'}_${randomBytes(8).toString('hex')}`;
  const plaintext = `${prefix}.${randomBytes(32).toString('base64url')}`;
  return { prefix, plaintext, hash: digest(plaintext) };
}

export function matchesApiKeyHash(plaintext: string, expectedHash: string) {
  const candidate = Buffer.from(digest(plaintext), 'hex');
  const stored = Buffer.from(expectedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

export function parseBearerApiKey(request: Request) {
  const url = new URL(request.url);
  if (
    ['api_key', 'apikey', 'key', 'access_token'].some((name) =>
      url.searchParams.has(name)
    )
  )
    return null;
  const authorization = request.headers.get('authorization');
  if (!authorization || authorization.includes(',')) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const parsed = match ? API_KEY_PATTERN.exec(match[1]) : null;
  return parsed ? { plaintext: match![1], prefix: parsed[1] } : null;
}

function publicKey(key: ApiKey) {
  const status =
    key.status === 'REVOKED'
      ? 'REVOKED'
      : key.expiresAt && key.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'ACTIVE';
  return {
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    scopes: key.scopes,
    status,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

export async function createPersonalApiKey(
  userId: string,
  input: { name: string; scopes: ApiKeyScope[]; expiresAt?: Date | null }
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const material = generateApiKeyMaterial();
    try {
      const key = await prisma.$transaction(async (transaction) => {
        const created = await transaction.apiKey.create({
          data: {
            userId,
            name: input.name,
            keyPrefix: material.prefix,
            keyHash: material.hash,
            scopes: input.scopes,
            expiresAt: input.expiresAt ?? null,
          },
        });
        await transaction.apiAuditEvent.create({
          data: {
            userId,
            apiKeyId: created.id,
            action: 'API_KEY_CREATED',
            targetId: created.id,
          },
        });
        return created;
      });
      return { ...publicKey(key), key: material.plaintext };
    } catch (error: any) {
      if (error?.code !== 'P2002' || attempt === 2) throw error;
    }
  }
  throw new Error('API key generation failed.');
}

export async function listPersonalApiKeys(userId: string) {
  const keys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return keys.map(publicKey);
}

export async function revokePersonalApiKey(userId: string, id: string) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.apiKey.findFirst({
      where: { id, userId },
    });
    if (!existing) return null;
    const now = new Date();
    const key =
      existing.status === 'REVOKED'
        ? existing
        : await transaction.apiKey.update({
            where: { id },
            data: { status: 'REVOKED', revokedAt: now },
          });
    if (existing.status !== 'REVOKED')
      await transaction.apiAuditEvent.create({
        data: {
          userId,
          apiKeyId: id,
          action: 'API_KEY_REVOKED',
          targetId: id,
        },
      });
    return publicKey(key);
  });
}

export interface ApiKeyPrincipal {
  keyId: string;
  user: User;
  scopes: ReadonlySet<ApiKeyScope>;
}

export async function authenticateApiKey(
  request: Request
): Promise<ApiKeyPrincipal | null> {
  const parsed = parseBearerApiKey(request);
  if (!parsed) return null;
  const key = await prisma.apiKey.findUnique({
    where: { keyPrefix: parsed.prefix },
    include: {
      user: { include: { accountDeletion: { select: { status: true } } } },
    },
  });
  const candidate = Buffer.from(digest(parsed.plaintext), 'hex');
  const stored = Buffer.from(key?.keyHash ?? '0'.repeat(64), 'hex');
  const matches =
    candidate.length === stored.length && timingSafeEqual(candidate, stored);
  const now = new Date();
  if (
    !key ||
    !matches ||
    key.status !== 'ACTIVE' ||
    Boolean(key.revokedAt) ||
    (key.expiresAt !== null && key.expiresAt <= now) ||
    ['PENDING', 'FAILED', 'COMPLETED'].includes(
      key.user.accountDeletion?.status ?? ''
    )
  )
    return null;
  const scopes = key.scopes.filter((scope): scope is ApiKeyScope =>
    API_KEY_SCOPES.includes(scope as ApiKeyScope)
  );
  void prisma.apiKey
    .updateMany({
      where: {
        id: key.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
      data: { lastUsedAt: now },
    })
    .catch(() => undefined);
  const { accountDeletion: _deletion, ...user } = key.user;
  return { keyId: key.id, user, scopes: new Set(scopes) };
}

export function hashIdempotencyValue(value: string) {
  return digest(`idempotency:${value}`);
}
