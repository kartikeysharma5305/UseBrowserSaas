import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function encryptionKey() {
  const encoded = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY is required.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32)
    throw new Error(
      'WEBHOOK_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.'
    );
  return key;
}

export function generateSigningSecret() {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function protectSigningSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return {
    secretCiphertext: ciphertext.toString('base64'),
    secretIv: iv.toString('base64'),
    secretTag: cipher.getAuthTag().toString('base64'),
    secretPrefix: secret.slice(0, 12),
  };
}

export function revealSigningSecret(input: {
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
}) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(input.secretIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(input.secretTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(input.secretCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export function signWebhookBody(input: {
  secret: string;
  eventId: string;
  timestamp: number;
  rawBody: string;
}) {
  const signature = createHmac('sha256', input.secret)
    .update(`${input.eventId}.${input.timestamp}.${input.rawBody}`, 'utf8')
    .digest('hex');
  return `v1=${signature}`;
}

export function verifyWebhookSignature(expected: string, candidate: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}
