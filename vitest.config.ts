import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./dashboard/src', import.meta.url)),
      'next/server': fileURLToPath(
        new URL('./dashboard/node_modules/next/server.js', import.meta.url)
      ),
      // Map Next.js-only module 'server-only' to a lightweight shim for tests
      'server-only': fileURLToPath(new URL('./dashboard/src/lib/billing/server-only-shim.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
});
