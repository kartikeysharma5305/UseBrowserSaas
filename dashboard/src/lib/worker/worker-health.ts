import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import type { WorkerInstanceStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

export function createWorkerInstanceId(): string {
  const host = hostname()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .slice(0, 64);
  return `${host}-${process.pid}-${randomUUID()}`;
}

export function workerBuildVersion(): string | null {
  const value = process.env.WORKER_BUILD_VERSION?.trim();
  return value ? value.slice(0, 80) : null;
}

export async function registerWorkerInstance(input: {
  id: string;
  concurrency: number;
  buildVersion?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await prisma.workerInstance.create({
    data: {
      id: input.id,
      status: 'STARTING',
      concurrency: input.concurrency,
      buildVersion: input.buildVersion ?? null,
      startedAt: now,
      lastHeartbeatAt: now,
    },
  });
}

export async function heartbeatWorkerInstance(input: {
  id: string;
  status: Extract<WorkerInstanceStatus, 'ACTIVE' | 'DRAINING'>;
  activeCount: number;
  now?: Date;
}): Promise<boolean> {
  const result = await prisma.workerInstance.updateMany({
    where: { id: input.id, status: { notIn: ['STOPPED', 'LOST'] } },
    data: {
      status: input.status,
      activeCount: Math.max(0, input.activeCount),
      lastHeartbeatAt: input.now ?? new Date(),
    },
  });
  return result.count === 1;
}

export async function stopWorkerInstance(id: string, now = new Date()) {
  await prisma.workerInstance.updateMany({
    where: { id },
    data: {
      status: 'STOPPED',
      activeCount: 0,
      lastHeartbeatAt: now,
      stoppedAt: now,
    },
  });
}

export async function markLostWorkerInstances(cutoff: Date): Promise<number> {
  const result = await prisma.workerInstance.updateMany({
    where: {
      status: { in: ['STARTING', 'ACTIVE', 'DRAINING'] },
      lastHeartbeatAt: { lt: cutoff },
    },
    data: { status: 'LOST', activeCount: 0 },
  });
  return result.count;
}
