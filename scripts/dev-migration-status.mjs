import { spawnSync } from 'node:child_process';

const pnpmScript = process.env.npm_execpath;
const command = pnpmScript ? process.execPath : 'pnpm';
const args = pnpmScript
  ? [pnpmScript, '--dir', 'dashboard', 'prisma:status']
  : ['--dir', 'dashboard', 'prisma:status'];

const result = spawnSync(command, args, {
  encoding: 'utf8',
  shell: !pnpmScript,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.status !== 0) {
  console.error(
    'Pending or failed migrations block dev startup. Run: pnpm setup:local'
  );
  process.exit(result.status ?? 1);
}
