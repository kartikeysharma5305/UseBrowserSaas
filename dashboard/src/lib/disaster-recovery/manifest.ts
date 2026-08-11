import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const BACKUP_MANIFEST_VERSION = 1 as const;

export interface DatabaseBackupManifest {
  version: typeof BACKUP_MANIFEST_VERSION;
  kind: 'postgresql-custom';
  createdAt: string;
  applicationVersion: string;
  databaseName: string;
  migrationCount: number;
  migrationSha256: string;
  archive: { file: string; size: number; sha256: string };
  secretsIncluded: false;
}

export interface ArtifactBackupEntry {
  artifactId: string;
  storageKey: string;
  size: number;
  checksum: string | null;
}

export interface ArtifactBackupManifest {
  version: typeof BACKUP_MANIFEST_VERSION;
  kind: 'local-artifacts' | 's3-expected-objects';
  createdAt: string;
  objectCount: number;
  totalBytes: number;
  objects: ArtifactBackupEntry[];
  secretsIncluded: false;
}

export async function sha256File(file: string) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.readableWebStream())
      hash.update(Buffer.from(chunk));
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function validateDatabaseManifest(
  value: unknown
): DatabaseBackupManifest {
  const manifest = value as Partial<DatabaseBackupManifest> | null;
  if (
    !manifest ||
    manifest.version !== BACKUP_MANIFEST_VERSION ||
    manifest.kind !== 'postgresql-custom' ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    typeof manifest.applicationVersion !== 'string' ||
    !manifest.applicationVersion ||
    typeof manifest.databaseName !== 'string' ||
    !manifest.databaseName ||
    !Number.isSafeInteger(manifest.migrationCount) ||
    manifest.migrationCount! < 0 ||
    !isSha256(manifest.migrationSha256) ||
    !manifest.archive ||
    typeof manifest.archive.file !== 'string' ||
    path.basename(manifest.archive.file) !== manifest.archive.file ||
    !Number.isSafeInteger(manifest.archive.size) ||
    manifest.archive.size! < 1 ||
    !isSha256(manifest.archive.sha256) ||
    manifest.secretsIncluded !== false
  ) {
    throw new Error('Backup manifest is invalid or unsupported.');
  }
  return manifest as DatabaseBackupManifest;
}

export async function verifyDatabaseBackup(manifestPath: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('Backup manifest is missing or unreadable.');
  }
  const manifest = validateDatabaseManifest(decoded);
  const archivePath = path.join(
    path.dirname(manifestPath),
    manifest.archive.file
  );
  let stat;
  try {
    stat = await fs.stat(archivePath);
  } catch {
    throw new Error('Backup archive is missing.');
  }
  if (!stat.isFile() || stat.size !== manifest.archive.size)
    throw new Error('Backup archive size does not match its manifest.');
  if ((await sha256File(archivePath)) !== manifest.archive.sha256)
    throw new Error('Backup archive checksum does not match its manifest.');
  return { manifest, archivePath };
}

export function validateArtifactManifest(
  value: unknown
): ArtifactBackupManifest {
  const manifest = value as Partial<ArtifactBackupManifest> | null;
  if (
    !manifest ||
    manifest.version !== BACKUP_MANIFEST_VERSION ||
    !['local-artifacts', 's3-expected-objects'].includes(manifest.kind ?? '') ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Number.isSafeInteger(manifest.objectCount) ||
    manifest.objectCount! < 0 ||
    !Number.isSafeInteger(manifest.totalBytes) ||
    manifest.totalBytes! < 0 ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length !== manifest.objectCount ||
    manifest.secretsIncluded !== false
  )
    throw new Error('Artifact manifest is invalid or unsupported.');
  for (const item of manifest.objects) {
    if (
      !item ||
      typeof item.artifactId !== 'string' ||
      typeof item.storageKey !== 'string' ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      (item.checksum !== null && !isSha256(item.checksum))
    )
      throw new Error('Artifact manifest contains an invalid object entry.');
  }
  return manifest as ArtifactBackupManifest;
}
