import { prisma } from '../src/lib/db/prisma';
import { LocalArtifactStorage } from '../src/lib/browser/artifact-storage';
import { createArtifactStorage } from '../src/lib/browser/artifact-storage-factory';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const environment = args
  .find((value) => value.startsWith('--environment='))
  ?.slice('--environment='.length);
const runId = args
  .find((value) => value.startsWith('--run-id='))
  ?.slice('--run-id='.length);
const artifactId = args
  .find((value) => value.startsWith('--artifact-id='))
  ?.slice('--artifact-id='.length);
const batchRaw = args
  .find((value) => value.startsWith('--batch-size='))
  ?.slice('--batch-size='.length);
const batchSize = batchRaw ? Number(batchRaw) : 100;
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  throw new Error('batch-size must be an integer from 1 to 500.');
}
if (apply) {
  const expected = process.env.ARTIFACT_MIGRATION_ENVIRONMENT?.trim();
  if (!expected || environment !== expected) {
    throw new Error(
      'Apply requires --environment matching ARTIFACT_MIGRATION_ENVIRONMENT.'
    );
  }
}

const source = new LocalArtifactStorage();
const destination = createArtifactStorage('S3');
const artifacts = await prisma.runArtifact.findMany({
  where: {
    storageProvider: 'LOCAL',
    ...(runId ? { runId } : {}),
    ...(artifactId ? { id: artifactId } : {}),
  },
  orderBy: { createdAt: 'asc' },
  take: batchSize,
});
const result = {
  dryRun: !apply,
  inspected: artifacts.length,
  migrated: 0,
  failed: 0,
  localDeleted: 0,
};

for (const artifact of artifacts) {
  if (!apply) continue;
  let remoteKey: string | null = null;
  try {
    const data = await source.read(artifact.storageKey);
    const saved = await destination.save({
      runId: artifact.runId,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType as 'image/png' | 'image/jpeg',
      data,
    });
    remoteKey = saved.storageKey;
    const updated = await prisma.runArtifact.updateMany({
      where: {
        id: artifact.id,
        storageProvider: 'LOCAL',
        storageKey: artifact.storageKey,
      },
      data: {
        storageProvider: 'S3',
        storageKey: saved.storageKey,
        checksum: saved.checksum,
        size: saved.size,
      },
    });
    if (updated.count !== 1) {
      await destination.delete(saved.storageKey);
      continue;
    }
    result.migrated += 1;
    await source.delete(artifact.storageKey);
    result.localDeleted += 1;
  } catch {
    result.failed += 1;
    if (remoteKey) await destination.delete(remoteKey).catch(() => undefined);
  }
}

console.log(JSON.stringify(result));
await prisma.$disconnect();
if (result.failed > 0) process.exitCode = 1;
