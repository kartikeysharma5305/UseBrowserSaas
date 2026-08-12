import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const originalSecret = process.env.BETTER_AUTH_SECRET;
const originalUrl = process.env.BETTER_AUTH_URL;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = originalSecret;
  if (originalUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = originalUrl;
  vi.resetModules();
});

describe('auth production-build safety', () => {
  it('does not require runtime auth configuration merely to import the module', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    vi.resetModules();

    const authModule = await import('../dashboard/src/lib/auth/index');

    expect(authModule.getAuth).toBeTypeOf('function');
    expect(() => authModule.getAuth()).toThrow(/BETTER_AUTH_(SECRET|URL) is required/);
  });

  it('keeps authenticated dashboard pages dynamic during production builds', async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        '../dashboard/src/app/dashboard/layout.tsx'
      ),
      'utf8'
    );
    expect(source).toContain("export const dynamic = 'force-dynamic'");
  });
});
