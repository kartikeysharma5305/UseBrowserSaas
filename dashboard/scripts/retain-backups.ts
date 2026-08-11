import { promises as fs } from 'node:fs';
import path from 'node:path';

import { verifyDatabaseBackup } from '../src/lib/disaster-recovery/manifest';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const directory = path.resolve(
  argument('--directory') ?? path.join(repositoryRoot, 'backups', 'postgresql')
);
const keep = Number(
  argument('--keep') ?? process.env.BACKUP_RETENTION_COUNT ?? 7
);
const days = Number(
  argument('--days') ?? process.env.BACKUP_RETENTION_DAYS ?? 30
);
if (!Number.isSafeInteger(keep) || keep < 1 || keep > 10_000)
  throw new Error('Backup retention count must be between 1 and 10000.');
if (!Number.isSafeInteger(days) || days < 1 || days > 3_650)
  throw new Error('Backup retention days must be between 1 and 3650.');

const names = await fs.readdir(directory).catch((error: any) => {
  if (error?.code === 'ENOENT') return [] as string[];
  throw error;
});
const valid = [];
let invalid = 0;
for (const name of names.filter((name) => name.endsWith('.manifest.json'))) {
  try {
    const result = await verifyDatabaseBackup(path.join(directory, name));
    valid.push({ ...result, manifestPath: path.join(directory, name) });
  } catch {
    invalid += 1;
  }
}
valid.sort((left, right) =>
  right.manifest.createdAt.localeCompare(left.manifest.createdAt)
);
const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
const candidates = valid.filter(
  (item, index) =>
    index >= keep && Date.parse(item.manifest.createdAt) < cutoff && index > 0
);
if (process.argv.includes('--apply')) {
  for (const item of candidates) {
    await fs.rm(item.archivePath);
    await fs.rm(item.manifestPath);
  }
}
console.info(
  JSON.stringify({
    operation: 'backup-retention',
    mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    valid: valid.length,
    invalidPreserved: invalid,
    candidates: candidates.length,
    deleted: process.argv.includes('--apply') ? candidates.length : 0,
    newestPreserved: valid.length > 0,
  })
);
