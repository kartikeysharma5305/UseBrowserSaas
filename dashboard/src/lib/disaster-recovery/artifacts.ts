import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  assertValidArtifactStorageKey,
  type ArtifactStorage,
} from '@/lib/browser/artifact-storage';
import {
  BACKUP_MANIFEST_VERSION,
  type ArtifactBackupEntry,
  type ArtifactBackupManifest,
  validateArtifactManifest,
} from './manifest';

export interface ArtifactConsistencyReport {
  checked: number;
  present: number;
  missing: string[];
  sizeMismatch: string[];
  checksumMismatch: string[];
  orphaned: string[];
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, target)));
    else if (entry.isFile())
      files.push(path.relative(root, target).split(path.sep).join('/'));
  }
  return files;
}

export async function verifyArtifactObjects(input: {
  storage: ArtifactStorage;
  objects: ArtifactBackupEntry[];
  listRoot?: string;
  verifyChecksum?: boolean;
}): Promise<ArtifactConsistencyReport> {
  const report: ArtifactConsistencyReport = {
    checked: input.objects.length,
    present: 0,
    missing: [],
    sizeMismatch: [],
    checksumMismatch: [],
    orphaned: [],
  };
  for (const object of input.objects) {
    assertValidArtifactStorageKey(object.storageKey);
    try {
      const stat = await input.storage.stat(object.storageKey);
      if (stat.size !== object.size) {
        report.sizeMismatch.push(object.artifactId);
        continue;
      }
      if (input.verifyChecksum && object.checksum) {
        const digest = createHash('sha256')
          .update(await input.storage.read(object.storageKey))
          .digest('hex');
        if (digest !== object.checksum) {
          report.checksumMismatch.push(object.artifactId);
          continue;
        }
      }
      report.present += 1;
    } catch {
      report.missing.push(object.artifactId);
    }
  }
  if (input.listRoot) {
    const expected = new Set(input.objects.map((item) => item.storageKey));
    report.orphaned = (await listFiles(path.resolve(input.listRoot))).filter(
      (key) => key !== 'artifacts.manifest.json' && !expected.has(key)
    );
  }
  return report;
}

export async function copyLocalArtifactBackup(input: {
  storage: ArtifactStorage;
  destination: string;
  objects: ArtifactBackupEntry[];
  createdAt?: Date;
}) {
  const destination = path.resolve(input.destination);
  await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  for (const object of input.objects) {
    assertValidArtifactStorageKey(object.storageKey);
    const data = await input.storage.read(object.storageKey);
    if (data.byteLength !== object.size)
      throw new Error(`Artifact size mismatch for ${object.artifactId}.`);
    const target = path.resolve(destination, object.storageKey);
    const relative = path.relative(destination, target);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Artifact backup target escaped its destination.');
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }
  const manifest: ArtifactBackupManifest = {
    version: BACKUP_MANIFEST_VERSION,
    kind: 'local-artifacts',
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    objectCount: input.objects.length,
    totalBytes: input.objects.reduce((sum, item) => sum + item.size, 0),
    objects: input.objects,
    secretsIncluded: false,
  };
  await fs.writeFile(
    path.join(destination, 'artifacts.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  );
  return manifest;
}

export async function readArtifactManifest(manifestPath: string) {
  try {
    return validateArtifactManifest(
      JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Artifact manifest is unreadable.');
    throw error;
  }
}
