import type { ArtifactStorageProvider } from '@prisma/client';

import { LocalArtifactStorage, type ArtifactStorage } from './artifact-storage';
import { getArtifactStorageConfiguration } from './artifact-storage-config';
import { S3ArtifactStorage } from './s3-artifact-storage';

export function createArtifactStorage(
  provider?: ArtifactStorageProvider
): ArtifactStorage {
  const configuration = getArtifactStorageConfiguration();
  const selected = provider ?? configuration.driver;
  if (selected === 'LOCAL') return new LocalArtifactStorage();
  if (!configuration.s3) {
    throw new Error('S3 artifact storage is not configured.');
  }
  return new S3ArtifactStorage(configuration.s3);
}
