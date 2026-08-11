import path from 'node:path';

import { runNative } from '../src/lib/disaster-recovery/postgres';

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const tsx = path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const jobs = [
  { subsystem: 'browser-runs', script: 'recover-queue.ts', args: ['--apply'] },
  {
    subsystem: 'notifications',
    script: 'reconcile-notifications.ts',
    args: [],
  },
  { subsystem: 'webhooks', script: 'reconcile-webhooks.ts', args: [] },
] as const;
const results: Array<{ subsystem: string; status: 'ok' | 'failed' }> = [];
for (const job of jobs) {
  try {
    await runNative(
      process.execPath,
      [
        tsx,
        '--env-file=.env',
        '--env-file=.env.local',
        path.join('scripts', job.script),
        ...job.args,
      ],
      { cwd: dashboardRoot }
    );
    results.push({ subsystem: job.subsystem, status: 'ok' });
  } catch {
    results.push({ subsystem: job.subsystem, status: 'failed' });
  }
}
console.info(JSON.stringify({ operation: 'reconcile-all', results }));
if (results.some((result) => result.status === 'failed'))
  throw new Error('One or more durable queue reconciliations failed.');
