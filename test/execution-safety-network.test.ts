import { describe, expect, it } from 'vitest';

import { assertPublicResolution, isUnsafeNetworkAddress } from '@/lib/execution-safety/network';

describe('execution safety network policy', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1',
    '192.168.1.1', '224.0.0.1', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
  ])('blocks non-public address %s', (address) => {
    expect(isUnsafeNetworkAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => expect(isUnsafeNetworkAddress(address)).toBe(false)
  );

  it('allows a hostname only when every DNS answer is public', async () => {
    await expect(assertPublicResolution('example.com', async () => [{ address: '93.184.216.34', family: 4 }])).resolves.toBeUndefined();
    await expect(assertPublicResolution('example.com', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ])).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED' });
  });

  it.each(['localhost', 'service.localhost', '127.0.0.1', '::1', '169.254.169.254'])(
    'blocks local or metadata target %s before navigation',
    async (hostname) => expect(assertPublicResolution(hostname, async () => [{ address: hostname, family: 4 }])).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED' })
  );

  it('fails closed on DNS failure or an empty response', async () => {
    await expect(assertPublicResolution('example.com', async () => { throw new Error('dns'); })).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED' });
    await expect(assertPublicResolution('example.com', async () => [])).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED' });
  });
});
