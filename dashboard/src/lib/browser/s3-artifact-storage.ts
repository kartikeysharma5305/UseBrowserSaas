import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  isSupportedArtifactMimeType,
  MAX_ARTIFACT_BYTES,
} from '@/lib/observability/artifacts';

import {
  ArtifactStorageError,
  assertValidArtifactStorageKey,
  createArtifactStorageKey,
  type ArtifactStat,
  type ArtifactStorage,
  type SaveArtifactInput,
  type SavedArtifact,
} from './artifact-storage';
import type { S3ArtifactStorageConfiguration } from './artifact-storage-config';

function storageFailure(): ArtifactStorageError {
  return new ArtifactStorageError(
    'Object storage operation failed.',
    'STORAGE_FAILURE'
  );
}

export class S3ArtifactStorage implements ArtifactStorage {
  readonly provider = 'S3' as const;
  private readonly client: S3Client;

  constructor(private readonly configuration: S3ArtifactStorageConfiguration) {
    this.client = new S3Client({
      region: configuration.region,
      ...(configuration.endpoint ? { endpoint: configuration.endpoint } : {}),
      forcePathStyle: configuration.forcePathStyle,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
  }

  async save(input: SaveArtifactInput): Promise<SavedArtifact> {
    if (
      !isSupportedArtifactMimeType(input.mimeType) ||
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
    const checksum = createHash('sha256').update(input.data).digest('hex');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.configuration.bucket,
          Key: storageKey,
          Body: input.data,
          ContentLength: input.data.byteLength,
          ContentType: input.mimeType,
          ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
        })
      );
      const stat = await this.stat(storageKey);
      if (stat.size !== input.data.byteLength) throw storageFailure();
      return {
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.data.byteLength,
        checksum,
      };
    } catch (error) {
      if (error instanceof ArtifactStorageError) throw error;
      throw storageFailure();
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    const stream = await this.readStream(storageKey);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += value.byteLength;
      if (total > MAX_ARTIFACT_BYTES) {
        throw new ArtifactStorageError(
          'Artifact exceeds the configured size limit.',
          'ARTIFACT_TOO_LARGE'
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  async readStream(storageKey: string): Promise<Readable> {
    assertValidArtifactStorageKey(storageKey);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.configuration.bucket,
          Key: storageKey,
        })
      );
      if (!result.Body) {
        throw new ArtifactStorageError(
          'Artifact not found.',
          'ARTIFACT_NOT_FOUND'
        );
      }
      if (result.Body instanceof Readable) return result.Body;
      return Readable.fromWeb(
        result.Body.transformToWebStream() as unknown as import('node:stream/web').ReadableStream
      );
    } catch (error) {
      if (error instanceof ArtifactStorageError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) {
        throw new ArtifactStorageError(
          'Artifact not found.',
          'ARTIFACT_NOT_FOUND'
        );
      }
      throw storageFailure();
    }
  }

  async stat(storageKey: string): Promise<ArtifactStat> {
    assertValidArtifactStorageKey(storageKey);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.configuration.bucket,
          Key: storageKey,
        })
      );
      if (
        result.ContentLength === undefined ||
        result.ContentLength < 0 ||
        result.ContentLength > MAX_ARTIFACT_BYTES
      ) {
        throw storageFailure();
      }
      return { size: result.ContentLength };
    } catch (error) {
      if (error instanceof ArtifactStorageError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) {
        throw new ArtifactStorageError(
          'Artifact not found.',
          'ARTIFACT_NOT_FOUND'
        );
      }
      throw storageFailure();
    }
  }

  async delete(storageKey: string): Promise<void> {
    assertValidArtifactStorageKey(storageKey);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.configuration.bucket,
          Key: storageKey,
        })
      );
    } catch {
      throw storageFailure();
    }
  }
}
