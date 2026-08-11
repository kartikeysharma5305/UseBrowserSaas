import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { incrementCounter } from '@/lib/operations/metrics';
import { PrismaAgentExecutionService } from '@/lib/execution/prisma-agent-execution-service';
import { hashIdempotencyValue } from './api-keys';

export class IdempotencyConflictError extends Error {}
export class IdempotencyInProgressError extends Error {}

function fingerprint(
  agentId: string,
  variables: Record<string, string | number | boolean>
) {
  const stable = JSON.stringify({
    agentId,
    variables: Object.fromEntries(
      Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))
    ),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function createIdempotentApiRun(input: {
  apiKeyId: string;
  userId: string;
  agentId: string;
  idempotencyKey: string;
  variables: Record<string, string | number | boolean>;
}) {
  const keyHash = hashIdempotencyValue(input.idempotencyKey);
  const requestFingerprint = fingerprint(input.agentId, input.variables);
  const now = new Date();
  await prisma.apiIdempotencyRequest.deleteMany({
    where: {
      apiKeyId: input.apiKeyId,
      expiresAt: { lt: now },
    },
  });
  let reservation;
  let created = false;
  try {
    reservation = await prisma.apiIdempotencyRequest.create({
      data: {
        apiKeyId: input.apiKeyId,
        userId: input.userId,
        operation: 'runs:create',
        idempotencyKeyHash: keyHash,
        requestFingerprint,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    created = true;
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    )
      throw error;
    reservation = await prisma.apiIdempotencyRequest.findUniqueOrThrow({
      where: {
        apiKeyId_operation_idempotencyKeyHash: {
          apiKeyId: input.apiKeyId,
          operation: 'runs:create',
          idempotencyKeyHash: keyHash,
        },
      },
    });
  }
  if (reservation.requestFingerprint !== requestFingerprint)
    throw new IdempotencyConflictError();
  if (reservation.runId) {
    incrementCounter('public_api_idempotent_replays_total', {});
    return { runId: reservation.runId, replayed: true };
  }
  if (!created && reservation.status === 'FAILED') {
    const claimed = await prisma.apiIdempotencyRequest.updateMany({
      where: { id: reservation.id, status: 'FAILED', runId: null },
      data: { status: 'PROCESSING', errorCode: null },
    });
    created = claimed.count === 1;
  }
  if (!created) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = await prisma.apiIdempotencyRequest.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      if (current.requestFingerprint !== requestFingerprint)
        throw new IdempotencyConflictError();
      if (current.runId) {
        incrementCounter('public_api_idempotent_replays_total', {});
        return { runId: current.runId, replayed: true };
      }
      if (current.status === 'FAILED') break;
    }
    throw new IdempotencyInProgressError();
  }
  const trustedRunId = `api-${reservation.id}`;
  try {
    const admitted = await new PrismaAgentExecutionService().runAgent({
      agentId: input.agentId,
      userId: input.userId,
      variables: input.variables,
      source: 'API',
      trustedRunId,
    });
    await prisma.$transaction([
      prisma.apiIdempotencyRequest.update({
        where: { id: reservation.id },
        data: { status: 'COMPLETED', runId: admitted.runId },
      }),
      prisma.apiAuditEvent.create({
        data: {
          userId: input.userId,
          apiKeyId: input.apiKeyId,
          action: 'API_RUN_ADMITTED',
          targetId: admitted.runId,
        },
      }),
    ]);
    return { runId: admitted.runId, replayed: false };
  } catch (error) {
    await prisma.apiIdempotencyRequest.update({
      where: { id: reservation.id },
      data: { status: 'FAILED', errorCode: 'RUN_ADMISSION_FAILED' },
    });
    throw error;
  }
}
