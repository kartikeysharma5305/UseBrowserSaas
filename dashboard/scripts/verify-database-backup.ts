import path from 'node:path';

import { verifyDatabaseBackup } from '../src/lib/disaster-recovery/manifest';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const manifestPath = argument('--manifest');
if (!manifestPath) throw new Error('--manifest is required.');
const verified = await verifyDatabaseBackup(path.resolve(manifestPath));
console.info(
  JSON.stringify({
    operation: 'database-backup-verify',
    status: 'valid',
    createdAt: verified.manifest.createdAt,
    bytes: verified.manifest.archive.size,
    migrations: verified.manifest.migrationCount,
  })
);
