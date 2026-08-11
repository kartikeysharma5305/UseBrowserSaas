import path from 'node:path';

import { verifyDatabaseBackup } from '../src/lib/disaster-recovery/manifest';
import {
  findPostgresTool,
  postgresEnvironment,
  runNative,
  sameDatabase,
} from '../src/lib/disaster-recovery/postgres';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
if (!process.argv.includes('--confirm-empty-target'))
  throw new Error('Restore requires --confirm-empty-target.');
const manifestPath = argument('--manifest');
if (!manifestPath) throw new Error('--manifest is required.');
const targetUrl = process.env.RESTORE_DATABASE_URL?.trim();
if (!targetUrl) throw new Error('RESTORE_DATABASE_URL is required.');
if (
  process.env.DATABASE_URL &&
  sameDatabase(process.env.DATABASE_URL, targetUrl)
)
  throw new Error(
    'Restore target must differ from the configured application database.'
  );

const verified = await verifyDatabaseBackup(path.resolve(manifestPath));
const environment = postgresEnvironment(targetUrl);
const tableCount = (
  await runNative(
    findPostgresTool('psql'),
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--command',
      "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');",
    ],
    { env: environment, capture: true }
  )
).trim();
if (tableCount !== '0')
  throw new Error('Restore target is not empty; no data was changed.');

await runNative(
  findPostgresTool('pg_restore'),
  [
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    environment.PGDATABASE!,
    verified.archivePath,
  ],
  { env: environment }
);
await runNative(
  findPostgresTool('psql'),
  ['--no-psqlrc', '--command', 'SELECT 1;'],
  { env: environment, capture: true }
);
await runNative(
  process.execPath,
  [
    path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'status',
  ],
  { env: { ...environment, DATABASE_URL: targetUrl }, cwd: process.cwd() }
);
console.info(
  JSON.stringify({
    operation: 'database-restore',
    status: 'restored',
    sourceCreatedAt: verified.manifest.createdAt,
    migrations: verified.manifest.migrationCount,
  })
);
