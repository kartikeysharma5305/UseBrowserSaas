import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = 'dashboard/prisma/migrations';
const directories = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const invalid = directories.filter(
  (directory) =>
    !/^\d{14}_[a-z0-9_]+$/.test(directory) ||
    !fs.existsSync(path.join(root, directory, 'migration.sql'))
);
const edited = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=M', '--', `${root}/`],
  { encoding: 'utf8' }
).trim();

if (invalid.length || edited) {
  console.error('Migration integrity check failed.');
  if (invalid.length)
    console.error(`Invalid migration directories: ${invalid.join(', ')}`);
  if (edited) console.error('A historical migration has been modified.');
  process.exitCode = 1;
} else {
  console.log(
    `Migration integrity check passed (${directories.length} additive migrations).`
  );
}
