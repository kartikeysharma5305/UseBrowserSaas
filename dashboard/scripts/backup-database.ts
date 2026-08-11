import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  BACKUP_MANIFEST_VERSION,
  sha256File,
  type DatabaseBackupManifest,
} from '../src/lib/disaster-recovery/manifest';
import {
  findPostgresTool,
  migrationFingerprint,
  parsePostgresUrl,
  postgresEnvironment,
  runNative,
} from '../src/lib/disaster-recovery/postgres';

const dashboardRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(dashboardRoot, '..');
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archivePath = path.resolve(
  argument('--output') ??
    path.join(repositoryRoot, 'backups', 'postgresql', `${timestamp}.dump`)
);
const manifestPath = `${archivePath}.manifest.json`;
const temporary = `${archivePath}.tmp`;

for (const target of [archivePath, manifestPath])
  if (
    await fs.stat(target).then(
      () => true,
      () => false
    )
  )
    throw new Error('Backup output already exists; choose a new output path.');

await fs.mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 });
try {
  await runNative(
    findPostgresTool('pg_dump'),
    ['--format=custom', '--no-owner', '--no-privileges', '--file', temporary],
    { env: postgresEnvironment(databaseUrl) }
  );
  const stat = await fs.stat(temporary);
  if (!stat.isFile() || stat.size < 1)
    throw new Error('Database dump is empty.');
  const migrations = await migrationFingerprint(
    path.join(dashboardRoot, 'prisma', 'migrations')
  );
  const application = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
  ) as { version?: string };
  const manifest: DatabaseBackupManifest = {
    version: BACKUP_MANIFEST_VERSION,
    kind: 'postgresql-custom',
    createdAt: new Date().toISOString(),
    applicationVersion: application.version ?? 'unknown',
    databaseName: parsePostgresUrl(databaseUrl).databaseName,
    migrationCount: migrations.count,
    migrationSha256: migrations.sha256,
    archive: {
      file: path.basename(archivePath),
      size: stat.size,
      sha256: await sha256File(temporary),
    },
    secretsIncluded: false,
  };
  await fs.rename(temporary, archivePath);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.info(
    JSON.stringify({
      operation: 'database-backup',
      status: 'created',
      archive: path.relative(repositoryRoot, archivePath),
      manifest: path.relative(repositoryRoot, manifestPath),
      bytes: stat.size,
      migrations: migrations.count,
    })
  );
} catch (error) {
  await fs.rm(temporary, { force: true }).catch(() => undefined);
  throw error;
}
