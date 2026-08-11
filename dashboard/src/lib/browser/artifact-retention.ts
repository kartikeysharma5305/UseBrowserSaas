import { RunStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { getPlan } from '@/lib/plans/catalogue';

import type { ArtifactStorage } from './artifact-storage';
import { createArtifactStorage } from './artifact-storage-factory';

export interface ArtifactCleanupResult {
  inspected: number;
  eligible: number;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  dryRun: boolean;
}

export async function cleanupExpiredArtifacts(
  options: {
    dryRun?: boolean;
    now?: Date;
    retentionDays?: number;
    downgradeGraceDays?: number;
    limit?: number;
    storage?: ArtifactStorage;
  } = {}
): Promise<ArtifactCleanupResult> {
  const dryRun = options.dryRun ?? true;
  const now = options.now ?? new Date();
  const downgradeGraceDays =
    options.downgradeGraceDays ?? (options.retentionDays === undefined ? 3 : 0);
  const minimumRetentionDays = options.retentionDays ?? 7;
  const broadCutoff = new Date(
    now.getTime() -
      (minimumRetentionDays + downgradeGraceDays) * 24 * 60 * 60 * 1000
  );
  const artifacts = await prisma.runArtifact.findMany({
    where: {
      createdAt: { lt: broadCutoff },
      run: {
        status: {
          notIn: [RunStatus.QUEUED, RunStatus.RUNNING],
        },
      },
    },
    select: {
      id: true,
      runId: true,
      storageKey: true,
      storageProvider: true,
      size: true,
      createdAt: true,
      run: {
        select: {
          agent: {
            select: {
              user: { select: { planCode: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 500,
  });
  const eligible = artifacts.filter((artifact) => {
    const retentionDays =
      options.retentionDays ??
      getPlan(artifact.run.agent.user.planCode).limits.retentionDays;
    const cutoff = new Date(
      now.getTime() - (retentionDays + downgradeGraceDays) * 24 * 60 * 60 * 1000
    );
    return artifact.createdAt < cutoff;
  });

  const result: ArtifactCleanupResult = {
    inspected: artifacts.length,
    eligible: eligible.length,
    deleted: 0,
    failed: 0,
    bytesReclaimed: 0,
    dryRun,
  };
  if (dryRun) return result;

  for (const artifact of eligible) {
    try {
      const storage =
        options.storage ?? createArtifactStorage(artifact.storageProvider);
      await storage.delete(artifact.storageKey);
      const deleted = await prisma.runArtifact.deleteMany({
        where: {
          id: artifact.id,
          storageKey: artifact.storageKey,
        },
      });
      if (deleted.count === 1) {
        result.deleted += 1;
        result.bytesReclaimed += artifact.size;
      }
    } catch (error) {
      result.failed += 1;
      logger.warn('Expired artifact cleanup failed', {
        artifactId: artifact.id,
        runId: artifact.runId,
        error: safeSerializeError(error),
      });
    }
  }

  logger.info('Artifact retention cleanup finished', result);
  return result;
}
