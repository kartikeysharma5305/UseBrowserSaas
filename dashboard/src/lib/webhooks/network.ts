import { isIP } from 'node:net';

import { parseSafetyUrl } from '@/lib/execution-safety/domain-policy';
import {
  assertPublicResolution,
  isUnsafeNetworkAddress,
  type AddressResolver,
} from '@/lib/execution-safety/network';

export class WebhookTargetError extends Error {
  constructor(public readonly code: string) {
    super('Webhook endpoint is not allowed.');
  }
}

function developmentLoopbackAllowed(hostname: string) {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS?.toLowerCase() !== 'true'
  )
    return false;
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
}

export async function assertWebhookTarget(
  raw: string,
  resolver?: AddressResolver
) {
  let parsed: ReturnType<typeof parseSafetyUrl>;
  try {
    parsed = parseSafetyUrl(raw);
  } catch {
    throw new WebhookTargetError('WEBHOOK_URL_INVALID');
  }
  const { url, hostname } = parsed;
  if (url.hash) throw new WebhookTargetError('WEBHOOK_URL_INVALID');
  if (url.protocol !== 'https:' && !developmentLoopbackAllowed(hostname))
    throw new WebhookTargetError('WEBHOOK_HTTPS_REQUIRED');
  if (developmentLoopbackAllowed(hostname)) return url.toString();
  if (isIP(hostname) && isUnsafeNetworkAddress(hostname))
    throw new WebhookTargetError('WEBHOOK_PRIVATE_NETWORK_BLOCKED');
  try {
    await assertPublicResolution(hostname, resolver);
  } catch {
    throw new WebhookTargetError('WEBHOOK_PRIVATE_NETWORK_BLOCKED');
  }
  return url.toString();
}
