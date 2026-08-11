import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import {
  isSupportedArtifactMimeType,
  MAX_ARTIFACT_BYTES,
  type SupportedArtifactMimeType,
} from '@/lib/observability/artifacts';

export interface SaveArtifactInput {
  runId: string;
  fileName: string;
  mimeType: SupportedArtifactMimeType;
  data: Buffer;
}

export interface SavedArtifact {
  storageKey: string;
  fileName: string;
  mimeType: SupportedArtifactMimeType;
  size: number;
  checksum: string;
}

export interface ArtifactStat {
  size: number;
}

export interface ArtifactStorage {
  readonly provider: 'LOCAL' | 'S3';
  save(input: SaveArtifactInput): Promise<SavedArtifact>;
  read(storageKey: string): Promise<Buffer>;
  readStream(storageKey: string): Promise<Readable>;
  stat(storageKey: string): Promise<ArtifactStat>;
  delete(storageKey: string): Promise<void>;
}

export class ArtifactStorageError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_STORAGE_KEY'
      | 'ARTIFACT_TOO_LARGE'
      | 'ARTIFACT_NOT_FOUND'
      | 'STORAGE_FAILURE'
  ) {
    super(message);
    this.name = 'ArtifactStorageError';
  }
}

export function resolveArtifactStorageRoot(): string {
  return path.resolve(
    process.env.ARTIFACT_STORAGE_ROOT ??
      path.join(process.cwd(), 'browseruse_agent_data', 'artifacts')
  );
}

export function assertValidArtifactStorageKey(storageKey: string): void {
  if (
    !storageKey ||
    storageKey.length > 512 ||
    storageKey.startsWith('/') ||
    storageKey.startsWith('\\') ||
    path.isAbsolute(storageKey) ||
    storageKey.includes('\0') ||
    storageKey.includes('\\') ||
    storageKey.split('/').some((segment) => !segment || segment === '..')
  ) {
    throw new ArtifactStorageError(
      'Invalid artifact storage key.',
      'INVALID_STORAGE_KEY'
    );
  }
}

export function createArtifactStorageKey(
  runId: string,
  mimeType: SupportedArtifactMimeType
): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
    throw new ArtifactStorageError(
      'Invalid artifact metadata.',
      'INVALID_STORAGE_KEY'
    );
  }
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  return path.posix.join('runs', runId, `${randomUUID()}.${extension}`);
}

export class LocalArtifactStorage implements ArtifactStorage {
  readonly provider = 'LOCAL' as const;
  readonly root: string;

  constructor(root = resolveArtifactStorageRoot()) {
    this.root = path.resolve(root);
  }

  private resolveKey(storageKey: string): string {
    assertValidArtifactStorageKey(storageKey);

    const resolved = path.resolve(this.root, storageKey);
    const relative = path.relative(this.root, resolved);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      relative === ''
    ) {
      throw new ArtifactStorageError(
        'Invalid artifact storage key.',
        'INVALID_STORAGE_KEY'
      );
    }
    return resolved;
  }

  async save(input: SaveArtifactInput): Promise<SavedArtifact> {
    if (
      !isSupportedArtifactMimeType(input.mimeType) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.runId) ||
      !/^[a-zA-Z0-9._-]{1,180}$/.test(input.fileName)
    ) {
      throw new ArtifactStorageError(
        'Invalid artifact metadata.',
        'INVALID_STORAGE_KEY'
      );
    }
    if (input.data.byteLength > MAX_ARTIFACT_BYTES) {
      throw new ArtifactStorageError(
        'Artifact exceeds the configured size limit.',
        'ARTIFACT_TOO_LARGE'
      );
    }

    const storageKey = createArtifactStorageKey(input.runId, input.mimeType);
    const target = this.resolveKey(storageKey);
    const tempTarget = `${target}.${randomUUID()}.tmp`;

    try {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(tempTarget, input.data, {
        flag: 'wx',
        mode: 0o600,
      });
      await fs.rename(tempTarget, target);
      return {
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.data.byteLength,
        checksum: createHash('sha256').update(input.data).digest('hex'),
      };
    } catch (error) {
      await fs.rm(tempTarget, { force: true }).catch(() => undefined);
      throw new ArtifactStorageError(
        error instanceof Error ? error.message : 'Artifact storage failed.',
        'STORAGE_FAILURE'
      );
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    const target = this.resolveKey(storageKey);
    try {
      const data = await fs.readFile(target);
      if (data.byteLength > MAX_ARTIFACT_BYTES) {
        throw new ArtifactStorageError(
          'Artifact exceeds the configured size limit.',
          'ARTIFACT_TOO_LARGE'
        );
      }
      return data;
    } catch (error) {
      if (error instanceof ArtifactStorageError) throw error;
      throw new ArtifactStorageError(
        'Artifact file not found.',
        'ARTIFACT_NOT_FOUND'
      );
    }
  }

  async readStream(storageKey: string): Promise<Readable> {
    const target = this.resolveKey(storageKey);
    await this.stat(storageKey);
    return createReadStream(target);
  }

  async stat(storageKey: string): Promise<ArtifactStat> {
    const target = this.resolveKey(storageKey);
    try {
      const result = await fs.stat(target);
      if (!result.isFile()) throw new Error('Not a file');
      return { size: result.size };
    } catch {
      throw new ArtifactStorageError(
        'Artifact file not found.',
        'ARTIFACT_NOT_FOUND'
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    await fs.rm(this.resolveKey(storageKey), { force: true });
  }
}
