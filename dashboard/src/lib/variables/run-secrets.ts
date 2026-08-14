import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

import type { Prisma } from '@prisma/client';

export type ProtectedRunSecrets = {
  version: 1;
  ciphertext: string;
  iv: string;
  tag: string;
};

function runSecretKey() {
  const encoded = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('Application encryption key is unavailable.');
  const rootKey = Buffer.from(encoded, 'base64');
  if (rootKey.length !== 32)
    throw new Error('Application encryption key is invalid.');
  return Buffer.from(
    hkdfSync('sha256', rootKey, Buffer.alloc(0), 'run-secret-variables-v1', 32)
  );
}

function associatedData(runId: string, agentId: string) {
  return Buffer.from(`run-secret-variables-v1\0${runId}\0${agentId}`, 'utf8');
}

export function protectRunSecrets(
  values: Record<string, string>,
  runId: string,
  agentId: string
): ProtectedRunSecrets | null {
  if (Object.keys(values).length === 0) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', runSecretKey(), iv);
  cipher.setAAD(associatedData(runId, agentId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), 'utf8'),
    cipher.final(),
  ]);
  return {
    version: 1,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function protectedRunInputFingerprint(value: string) {
  return createHmac('sha256', runSecretKey())
    .update(value, 'utf8')
    .digest('hex');
}

export function revealRunSecrets(
  snapshot: Prisma.JsonValue | null,
  runId: string,
  agentId: string
): Record<string, string> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return {};
  const envelope = (snapshot as Record<string, unknown>).secretEnvelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
    return {};
  const candidate = envelope as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.ciphertext !== 'string' ||
    typeof candidate.iv !== 'string' ||
    typeof candidate.tag !== 'string'
  )
    throw new Error('Run secret envelope is invalid.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    runSecretKey(),
    Buffer.from(candidate.iv, 'base64')
  );
  decipher.setAAD(associatedData(runId, agentId));
  decipher.setAuthTag(Buffer.from(candidate.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(candidate.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Run secret envelope is invalid.');
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || typeof value !== 'string')
      throw new Error('Run secret envelope is invalid.');
    values[key] = value;
  }
  return values;
}

export function domainScopedSecrets(
  values: Record<string, string>,
  domains: string[]
): Record<string, Record<string, string>> | null {
  if (Object.keys(values).length === 0) return null;
  return Object.fromEntries(domains.map((domain) => [domain, { ...values }]));
}

export function redactRunSecrets(value: string, secrets: string[]): string {
  return secrets
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value);
}

export function redactRunSecretValue(
  value: unknown,
  secrets: string[]
): unknown {
  const visited = new WeakSet<object>();
  const visit = (entry: unknown, depth: number): unknown => {
    if (typeof entry === 'string') return redactRunSecrets(entry, secrets);
    if (entry === null || typeof entry !== 'object') return entry;
    if (depth >= 12 || visited.has(entry)) return '[redacted]';
    visited.add(entry);
    if (Array.isArray(entry))
      return entry.map((item) => visit(item, depth + 1));
    return Object.fromEntries(
      Object.entries(entry).map(([key, item]) => [
        redactRunSecrets(key, secrets),
        visit(item, depth + 1),
      ])
    );
  };
  return visit(value, 0);
}
