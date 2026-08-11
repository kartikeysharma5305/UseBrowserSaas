import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildScreenshotCandidates,
  persistScreenshotCandidates,
} from '../dashboard/src/lib/browser/artifact-persistence.js';
import {
  ArtifactStorageError,
  LocalArtifactStorage,
} from '../dashboard/src/lib/browser/artifact-storage.js';
import { MAX_ARTIFACT_BYTES } from '../dashboard/src/lib/observability/artifacts.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test'),
]);

describe('local artifact storage', () => {
  let root: string;
  let storage: LocalArtifactStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'phase3a-artifacts-'));
    storage = new LocalArtifactStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves a valid PNG data URL', async () => {
    const [artifact] = await persistScreenshotCandidates(
      'run-1',
      [
        {
          kind: 'data-url',
          value: `data:image/png;base64,${png.toString('base64')}`,
          stepNumber: 1,
          eventSequence: 2,
        },
      ],
      storage
    );
    expect(artifact).toMatchObject({ mimeType: 'image/png', size: png.length });
    await expect(storage.read(artifact!.storageKey)).resolves.toEqual(png);
  });

  it('saves proven raw PNG base64 history values', async () => {
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      buildScreenshotCandidates([], [png.toString('base64')]),
      storage
    );
    expect(artifacts[0]?.stepNumber).toBe(1);
  });

  it('saves a proven history screenshot file source safely', async () => {
    const source = path.join(root, 'source.png');
    await writeFile(source, png);
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      buildScreenshotCandidates([], [], [source]),
      storage
    );
    expect(artifacts).toHaveLength(1);
  });

  it('rejects traversal storage keys', async () => {
    await expect(storage.read('../private.png')).rejects.toMatchObject({
      code: 'INVALID_STORAGE_KEY',
    });
  });

  it('rejects absolute storage keys', async () => {
    await expect(
      storage.read(path.join(root, 'private.png'))
    ).rejects.toBeInstanceOf(ArtifactStorageError);
  });

  it('rejects unsupported MIME content', async () => {
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      [
        {
          kind: 'data-url',
          value: `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`,
          stepNumber: 1,
          eventSequence: 2,
        },
      ],
      storage
    );
    expect(artifacts).toEqual([]);
  });

  it('rejects oversized images', async () => {
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      [
        {
          kind: 'base64',
          value: Buffer.alloc(MAX_ARTIFACT_BYTES + 1).toString('base64'),
          mimeType: 'image/png',
          stepNumber: 1,
          eventSequence: 2,
        },
      ],
      storage
    );
    expect(artifacts).toEqual([]);
  });

  it('does not overwrite duplicate server filenames', async () => {
    const first = await storage.save({
      runId: 'run',
      fileName: 'same.png',
      mimeType: 'image/png',
      data: png,
    });
    const second = await storage.save({
      runId: 'run',
      fileName: 'same.png',
      mimeType: 'image/png',
      data: png,
    });
    expect(first.storageKey).not.toBe(second.storageKey);
  });

  it('deduplicates identical screenshots in one run', async () => {
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      [
        {
          kind: 'base64',
          value: png.toString('base64'),
          mimeType: 'image/png',
          stepNumber: 1,
          eventSequence: 2,
        },
        {
          kind: 'base64',
          value: png.toString('base64'),
          mimeType: 'image/png',
          stepNumber: 1,
          eventSequence: 2,
        },
      ],
      storage
    );
    expect(artifacts).toHaveLength(1);
  });

  it('enforces the configured aggregate artifact bytes per run', async () => {
    const secondPng = Buffer.concat([png, Buffer.from([1])]);
    const artifacts = await persistScreenshotCandidates(
      'run-1',
      [
        {
          kind: 'base64',
          value: png.toString('base64'),
          mimeType: 'image/png',
          stepNumber: 1,
          eventSequence: 2,
        },
        {
          kind: 'base64',
          value: secondPng.toString('base64'),
          mimeType: 'image/png',
          stepNumber: 2,
          eventSequence: 3,
        },
      ],
      storage,
      png.length
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].size).toBe(png.length);
  });

  it('keeps reads inside the configured root', async () => {
    const saved = await storage.save({
      runId: 'run',
      fileName: 'safe.png',
      mimeType: 'image/png',
      data: png,
    });
    expect(
      path.relative(root, path.resolve(root, saved.storageKey))
    ).not.toMatch(/^\.\./);
  });

  it('returns a controlled missing-file error', async () => {
    await expect(storage.read('runs/run/missing.png')).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    });
  });

  it('reports stored file size without exposing a disk path', async () => {
    const saved = await storage.save({
      runId: 'run',
      fileName: 'safe.png',
      mimeType: 'image/png',
      data: png,
    });
    await expect(storage.stat(saved.storageKey)).resolves.toEqual({
      size: png.length,
    });
    expect(saved.storageKey).not.toContain(root);
  });
});
