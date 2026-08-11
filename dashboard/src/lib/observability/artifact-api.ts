import type { RunArtifact } from '@prisma/client';

import {
  isSupportedArtifactMimeType,
  type RunArtifactRecord,
} from './artifacts';

export function toArtifactApiRecord(
  artifact: RunArtifact
): RunArtifactRecord | null {
  if (
    artifact.type !== 'SCREENSHOT' ||
    !isSupportedArtifactMimeType(artifact.mimeType) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0
  ) {
    return null;
  }

  return {
    id: artifact.id,
    type: artifact.type,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    size: artifact.size,
    stepNumber: artifact.stepNumber,
    eventSequence: artifact.eventSequence,
    createdAt: artifact.createdAt.toISOString(),
    url: `/api/runs/${encodeURIComponent(artifact.runId)}/artifacts/${encodeURIComponent(artifact.id)}`,
  };
}
