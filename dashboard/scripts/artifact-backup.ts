import { promises as fs } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/db/prisma';
import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';
import { LocalArtifactStorage } from '../src/lib/browser/artifact-storage';
import {
  copyLocalArtifactBackup,
  readArtifactManifest,
  verifyArtifactObjects,
} from '../src/lib/disaster-recovery/artifacts';
import {
  BACKUP_MANIFEST_VERSION,
  type ArtifactBackupManifest,
} from '../src/lib/disaster-recovery/manifest';

const mode = process.argv[2];
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const suffixes = (values: string[]) => values.map((value) => value.slice(-8));

try {
  if (mode === 'backup') {
    const output = argument('--output');
    if (!output) throw new Error('--output is required.');
    const objects = await prisma.runArtifact.findMany({
      select: {
        id: true,
        storageKey: true,
        size: true,
        checksum: true,
        storageProvider: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const storage = createArtifactStorage();
    const providerObjects = objects.filter(
      (object) => object.storageProvider === storage.provider
    );
    const expectedObjects = providerObjects.map((object) => ({
      artifactId: object.id,
      storageKey: object.storageKey,
      size: object.size,
      checksum: object.checksum,
    }));
    let manifest: ArtifactBackupManifest;
    if (storage.provider === 'LOCAL') {
      manifest = await copyLocalArtifactBackup({
        storage,
        destination: output,
        objects: expectedObjects,
      });
    } else {
      const report = await verifyArtifactObjects({
        storage,
        objects: expectedObjects,
      });
      if (report.missing.length || report.sizeMismatch.length)
        throw new Error(
          'S3 expected-object manifest contains unavailable objects.'
        );
      await fs.mkdir(path.resolve(output), { recursive: false, mode: 0o700 });
      manifest = {
        version: BACKUP_MANIFEST_VERSION,
        kind: 's3-expected-objects',
        createdAt: new Date().toISOString(),
        objectCount: objects.length,
        totalBytes: objects.reduce((sum, object) => sum + object.size, 0),
        objects: expectedObjects,
        secretsIncluded: false,
      };
      await fs.writeFile(
        path.join(path.resolve(output), 'artifacts.manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 }
      );
    }
    console.info(
      JSON.stringify({
        operation: 'artifact-backup',
        status: 'created',
        kind: manifest.kind,
        objects: manifest.objectCount,
        bytes: manifest.totalBytes,
        otherProviderObjectsExcluded: objects.length - providerObjects.length,
      })
    );
  } else if (mode === 'verify') {
    const manifestArgument = argument('--manifest');
    let objects;
    let storage;
    let listRoot: string | undefined;
    if (manifestArgument) {
      const manifestPath = path.resolve(manifestArgument);
      const manifest = await readArtifactManifest(manifestPath);
      objects = manifest.objects;
      if (manifest.kind !== 'local-artifacts')
        throw new Error(
          'S3 expected-object manifests must be checked against configured S3 storage.'
        );
      listRoot = path.dirname(manifestPath);
      storage = new LocalArtifactStorage(listRoot);
    } else {
      storage = createArtifactStorage();
      objects = await prisma.runArtifact
        .findMany({
          where: { storageProvider: storage.provider },
          select: { id: true, storageKey: true, size: true, checksum: true },
        })
        .then((rows) =>
          rows.map((object) => ({
            artifactId: object.id,
            storageKey: object.storageKey,
            size: object.size,
            checksum: object.checksum,
          }))
        );
      if (storage instanceof LocalArtifactStorage) listRoot = storage.root;
    }
    const report = await verifyArtifactObjects({
      storage,
      objects,
      listRoot,
      verifyChecksum: process.argv.includes('--checksum'),
    });
    console.info(
      JSON.stringify({
        operation: 'artifact-verify',
        checked: report.checked,
        present: report.present,
        missing: suffixes(report.missing),
        sizeMismatch: suffixes(report.sizeMismatch),
        checksumMismatch: suffixes(report.checksumMismatch),
        orphanedCount: report.orphaned.length,
      })
    );
    if (
      report.missing.length ||
      report.sizeMismatch.length ||
      report.checksumMismatch.length ||
      report.orphaned.length
    )
      process.exitCode = 1;
  } else {
    throw new Error('Expected artifact-backup mode: backup or verify.');
  }
} finally {
  await prisma.$disconnect();
}
