import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { SafetyPolicyError } from './types';

export type AddressResolver = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export const systemAddressResolver: AddressResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function ipv4Number(address: string) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return null;
  return (
    (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
  );
}

function inV4(address: string, base: string, prefix: number) {
  const value = ipv4Number(address);
  const network = ipv4Number(base);
  if (value === null || network === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

export function isUnsafeNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (isIP(normalized) === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, prefix]) => inV4(normalized, String(base), Number(prefix)));
  }
  if (isIP(normalized) === 6) {
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      return isIP(mapped) === 4 ? isUnsafeNetworkAddress(mapped) : true;
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      /^ff/.test(normalized) ||
      normalized.startsWith('2001:db8:')
    );
  }
  return true;
}

export async function assertPublicResolution(
  hostname: string,
  resolver: AddressResolver = systemAddressResolver
) {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (isIP(hostname) !== 0 && isUnsafeNetworkAddress(hostname))
  )
    throw new SafetyPolicyError('PRIVATE_NETWORK_BLOCKED');
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new SafetyPolicyError('PRIVATE_NETWORK_BLOCKED');
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => isUnsafeNetworkAddress(address))
  )
    throw new SafetyPolicyError('PRIVATE_NETWORK_BLOCKED');
}
