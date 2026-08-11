import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalArtifactStorage } from '../dashboard/src/lib/browser/artifact-storage';
import { verifyArtifactObjects } from '../dashboard/src/lib/disaster-recovery/artifacts';
import {
  BACKUP_MANIFEST_VERSION,
  sha256File,
  verifyDatabaseBackup,
  type DatabaseBackupManifest,
} from '../dashboard/src/lib/disaster-recovery/manifest';
import {
  parsePostgresUrl,
  postgresEnvironment,
  sameDatabase,
} from '../dashboard/src/lib/disaster-recovery/postgres';
import {
  generateApiKeyMaterial,
  matchesApiKeyHash,
} from '../dashboard/src/lib/public-api/api-keys';
import {
  protectSigningSecret,
  revealSigningSecret,
} from '../dashboard/src/lib/webhooks/crypto';

const temporary: string[] = [];
const originalPepper = process.env.API_KEY_PEPPER;
const originalEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

async function tempDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phase24-'));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  if (originalPepper === undefined) delete process.env.API_KEY_PEPPER;
  else process.env.API_KEY_PEPPER = originalPepper;
  if (originalEncryptionKey === undefined)
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  else process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('Phase 24 backup manifests', () => {
  async function fixture() {
    const directory = await tempDirectory();
    const archive = path.join(directory, 'fixture.dump');
    await fs.writeFile(archive, Buffer.from('custom-format-fixture'));
    const stat = await fs.stat(archive);
    const manifest: DatabaseBackupManifest = {
      version: BACKUP_MANIFEST_VERSION,
      kind: 'postgresql-custom',
      createdAt: new Date().toISOString(),
      applicationVersion: 'test',
      databaseName: 'disposable',
      migrationCount: 18,
      migrationSha256: 'a'.repeat(64),
      archive: {
        file: path.basename(archive),
        size: stat.size,
        sha256: await sha256File(archive),
      },
      secretsIncluded: false,
    };
    const manifestPath = `${archive}.manifest.json`;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    return { archive, manifestPath };
  }

  it('verifies a complete checksum-bound manifest', async () => {
    const value = await fixture();
    const verified = await verifyDatabaseBackup(value.manifestPath);
    expect(verified.archivePath).toBe(value.archive);
    expect(verified.manifest.secretsIncluded).toBe(false);
  });

  it('rejects a corrupt archive', async () => {
    const value = await fixture();
    await fs.appendFile(value.archive, 'corrupt');
    await expect(verifyDatabaseBackup(value.manifestPath)).rejects.toThrow(
      /size|checksum/
    );
  });

  it('rejects a missing or malformed manifest', async () => {
    const directory = await tempDirectory();
    await expect(
      verifyDatabaseBackup(path.join(directory, 'missing.json'))
    ).rejects.toThrow('manifest');
    const invalid = path.join(directory, 'invalid.json');
    await fs.writeFile(invalid, '{}');
    await expect(verifyDatabaseBackup(invalid)).rejects.toThrow('invalid');
  });
});

describe('Phase 24 artifact consistency', () => {
  it('detects missing, wrong-size, corrupt, and orphan objects without deleting', async () => {
    const root = await tempDirectory();
    const storage = new LocalArtifactStorage(root);
    await fs.mkdir(path.join(root, 'runs', 'one'), { recursive: true });
    await fs.writeFile(path.join(root, 'runs', 'one', 'present.png'), 'abc');
    await fs.writeFile(path.join(root, 'runs', 'one', 'wrong.png'), 'long');
    await fs.writeFile(path.join(root, 'runs', 'one', 'corrupt.png'), 'xyz');
    await fs.writeFile(path.join(root, 'runs', 'one', 'orphan.png'), 'orphan');
    const report = await verifyArtifactObjects({
      storage,
      listRoot: root,
      verifyChecksum: true,
      objects: [
        {
          artifactId: 'present-id',
          storageKey: 'runs/one/present.png',
          size: 3,
          checksum:
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        {
          artifactId: 'missing-id',
          storageKey: 'runs/one/missing.png',
          size: 3,
          checksum: null,
        },
        {
          artifactId: 'wrong-id',
          storageKey: 'runs/one/wrong.png',
          size: 2,
          checksum: null,
        },
        {
          artifactId: 'corrupt-id',
          storageKey: 'runs/one/corrupt.png',
          size: 3,
          checksum: '0'.repeat(64),
        },
      ],
    });
    expect(report.present).toBe(1);
    expect(report.missing).toEqual(['missing-id']);
    expect(report.sizeMismatch).toEqual(['wrong-id']);
    expect(report.checksumMismatch).toEqual(['corrupt-id']);
    expect(report.orphaned).toContain('runs/one/orphan.png');
    await expect(
      fs.stat(path.join(root, 'runs', 'one', 'orphan.png'))
    ).resolves.toBeTruthy();
  });
});

describe('Phase 24 restore guards and secret continuity', () => {
  it('creates credential-free PostgreSQL child environment and detects the same target', () => {
    const value = 'postgresql://operator:private@localhost:5432/restored';
    expect(parsePostgresUrl(value).databaseName).toBe('restored');
    const environment = postgresEnvironment(value, {});
    expect(environment.PGDATABASE).toBe('restored');
    expect(environment.PGPASSWORD).toBe('private');
    expect(JSON.stringify(environment)).not.toContain(value);
    expect(
      sameDatabase(value, 'postgresql://other:different@localhost/restored')
    ).toBe(true);
  });

  it('fails webhook decryption safely with the wrong key and recovers with the original key', () => {
    const correctKey = randomBytes(32).toString('base64');
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = correctKey;
    const protectedValue = protectSigningSecret('disposable-signing-secret');
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
      randomBytes(32).toString('base64');
    expect(() => revealSigningSecret(protectedValue)).toThrow();
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = correctKey;
    expect(revealSigningSecret(protectedValue)).toBe(
      'disposable-signing-secret'
    );
  });

  it('requires the original API key pepper to validate persisted hashes', () => {
    process.env.API_KEY_PEPPER = 'a'.repeat(32);
    const material = generateApiKeyMaterial();
    expect(matchesApiKeyHash(material.plaintext, material.hash)).toBe(true);
    process.env.API_KEY_PEPPER = 'b'.repeat(32);
    expect(matchesApiKeyHash(material.plaintext, material.hash)).toBe(false);
  });
});
