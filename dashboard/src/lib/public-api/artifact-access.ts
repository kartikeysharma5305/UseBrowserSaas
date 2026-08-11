import { Readable } from 'node:stream';
import { prisma } from '@/lib/db/prisma';
import { createArtifactStorage } from '@/lib/browser/artifact-storage-factory';
import {
  isSupportedArtifactMimeType,
  MAX_ARTIFACT_BYTES,
} from '@/lib/observability/artifacts';

export async function openOwnedArtifact(
  userId: string,
  artifactId: string,
  runId?: string
) {
  const artifact = await prisma.runArtifact.findFirst({
    where: {
      id: artifactId,
      ...(runId ? { runId } : {}),
      run: { agent: { userId } },
      type: 'SCREENSHOT',
    },
  });
  if (
    !artifact ||
    !isSupportedArtifactMimeType(artifact.mimeType) ||
    artifact.size < 0 ||
    artifact.size > MAX_ARTIFACT_BYTES
  )
    return null;
  try {
    const storage = createArtifactStorage(artifact.storageProvider);
    const stat = await storage.stat(artifact.storageKey);
    if (stat.size !== artifact.size || stat.size > MAX_ARTIFACT_BYTES)
      return null;
    return {
      stream: Readable.toWeb(
        await storage.readStream(artifact.storageKey)
      ) as ReadableStream<Uint8Array>,
      size: artifact.size,
      mimeType: artifact.mimeType,
      fileName: artifact.fileName.replace(/[^a-zA-Z0-9._-]/g, '_'),
    };
  } catch {
    return null;
  }
}
