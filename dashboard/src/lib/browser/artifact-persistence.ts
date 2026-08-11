import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { safeSerializeError } from '@/lib/execution/errors';
import { getArtifactMaxBytesPerRun } from '@/lib/execution/configuration';
import { logger } from '@/lib/logger';
import {
  MAX_ARTIFACT_BYTES,
  type SupportedArtifactMimeType,
} from '@/lib/observability/artifacts';

import type { ArtifactStorage } from './artifact-storage';
import { createArtifactStorage } from './artifact-storage-factory';
import type { CollectedEvent, ScreenshotCandidate } from './event-collector';

export interface PersistedArtifact {
  id: string;
  type: 'SCREENSHOT';
  storageKey: string;
  storageProvider: 'LOCAL' | 'S3';
  checksum: string;
  fileName: string;
  mimeType: SupportedArtifactMimeType;
  size: number;
  stepNumber: number | null;
  eventSequence: number | null;
}

function detectMimeType(buffer: Buffer): SupportedArtifactMimeType | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  return null;
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s/g, '');
  if (
    compact.length === 0 ||
    compact.length > Math.ceil((MAX_ARTIFACT_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    throw new Error('Invalid or oversized screenshot base64.');
  }
  const buffer = Buffer.from(compact, 'base64');
  if (buffer.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('Screenshot exceeds the configured size limit.');
  }
  return buffer;
}

async function decodeScreenshotSource(
  source: ScreenshotCandidate
): Promise<{ buffer: Buffer; mimeType: SupportedArtifactMimeType }> {
  let buffer: Buffer;
  let declaredMimeType = source.mimeType;

  if (source.kind === 'data-url') {
    const match =
      /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
        source.value
      );
    if (!match) throw new Error('Unsupported screenshot data URL.');
    declaredMimeType = match[1].toLowerCase() as SupportedArtifactMimeType;
    buffer = decodeBase64(match[2]);
  } else if (source.kind === 'base64') {
    buffer = decodeBase64(source.value);
  } else {
    const stat = await fs.stat(source.value);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
      throw new Error('Invalid or oversized screenshot file.');
    }
    buffer = await fs.readFile(source.value);
  }

  const detectedMimeType = detectMimeType(buffer);
  if (
    !detectedMimeType ||
    (declaredMimeType && declaredMimeType !== detectedMimeType)
  ) {
    throw new Error(
      'Screenshot content does not match a supported image type.'
    );
  }
  return { buffer, mimeType: detectedMimeType };
}

function safeFileName(
  stepNumber: number | null,
  mimeType: SupportedArtifactMimeType
): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const step = stepNumber === null ? 'unknown' : String(stepNumber);
  return `screenshot-step-${step}-${randomUUID()}.${extension}`;
}

export async function persistScreenshotCandidates(
  runId: string,
  candidates: ScreenshotCandidate[],
  storage: ArtifactStorage = createArtifactStorage(),
  maxBytesPerRun = getArtifactMaxBytesPerRun(),
  maxArtifactsPerRun = Number.MAX_SAFE_INTEGER
): Promise<PersistedArtifact[]> {
  const artifacts: PersistedArtifact[] = [];
  const hashes = new Set<string>();
  let totalBytes = 0;

  for (const candidate of candidates) {
    if (artifacts.length >= maxArtifactsPerRun) {
      logger.warn('Screenshot artifact skipped by per-run count limit', {
        runId,
        maxArtifactsPerRun,
      });
      break;
    }
    try {
      const { buffer, mimeType } = await decodeScreenshotSource(candidate);
      const digest = createHash('sha256').update(buffer).digest('hex');
      if (hashes.has(digest)) continue;
      hashes.add(digest);
      if (totalBytes + buffer.byteLength > maxBytesPerRun) {
        logger.warn('Screenshot artifact skipped by per-run byte limit', {
          runId,
          maxBytesPerRun,
          acceptedBytes: totalBytes,
        });
        continue;
      }

      const saved = await storage.save({
        runId,
        fileName: safeFileName(candidate.stepNumber, mimeType),
        mimeType,
        data: buffer,
      });
      artifacts.push({
        id: randomUUID(),
        type: 'SCREENSHOT',
        storageKey: saved.storageKey,
        storageProvider: storage.provider,
        checksum: saved.checksum,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        size: saved.size,
        stepNumber: candidate.stepNumber,
        eventSequence: candidate.eventSequence,
      });
      totalBytes += saved.size;
    } catch (error) {
      logger.warn('Screenshot artifact was skipped', {
        runId,
        sourceKind: candidate.kind,
        stepNumber: candidate.stepNumber,
        eventSequence: candidate.eventSequence,
        error: safeSerializeError(error),
      });
    }
  }

  return artifacts;
}

export async function deletePersistedArtifacts(
  artifacts: PersistedArtifact[],
  storage?: ArtifactStorage
): Promise<void> {
  await Promise.allSettled(
    artifacts.map((artifact) =>
      (storage ?? createArtifactStorage(artifact.storageProvider)).delete(
        artifact.storageKey
      )
    )
  );
}

export function buildScreenshotCandidates(
  events: CollectedEvent[],
  historyScreenshots: Array<string | null>,
  historyScreenshotPaths: Array<string | null> = []
): ScreenshotCandidate[] {
  const candidates = events.flatMap((event) =>
    event.screenshot ? [event.screenshot] : []
  );

  for (let index = 0; index < historyScreenshots.length; index += 1) {
    const value = historyScreenshots[index];
    if (!value) continue;
    const stepNumber = index + 1;
    const eventSequence =
      events.find((event) => event.data.stepNumber === stepNumber)?.sequence ??
      null;
    candidates.push({
      kind: 'base64',
      value,
      mimeType: 'image/png',
      stepNumber,
      eventSequence,
    });
  }

  for (let index = 0; index < historyScreenshotPaths.length; index += 1) {
    const value = historyScreenshotPaths[index];
    if (!value || !path.isAbsolute(value)) continue;
    const stepNumber = index + 1;
    const eventSequence =
      events.find((event) => event.data.stepNumber === stepNumber)?.sequence ??
      null;
    candidates.push({
      kind: 'file',
      value,
      stepNumber,
      eventSequence,
    });
  }

  return candidates;
}
