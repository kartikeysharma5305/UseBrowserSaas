export const SUPPORTED_ARTIFACT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
] as const;
export type SupportedArtifactMimeType =
  (typeof SUPPORTED_ARTIFACT_MIME_TYPES)[number];

export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

export interface RunArtifactRecord {
  id: string;
  type: 'SCREENSHOT';
  fileName: string;
  mimeType: SupportedArtifactMimeType;
  size: number;
  stepNumber: number | null;
  eventSequence: number | null;
  createdAt: string;
  url: string;
}

export function isSupportedArtifactMimeType(
  value: unknown
): value is SupportedArtifactMimeType {
  return (
    typeof value === 'string' &&
    SUPPORTED_ARTIFACT_MIME_TYPES.includes(value as SupportedArtifactMimeType)
  );
}
