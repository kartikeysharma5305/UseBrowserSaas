import type { Prisma, RunStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sanitizePersistedExecutionError } from '@/lib/execution/errors';
import { normalizeOutputSchema } from '@/lib/structured-results';

type Cursor = { createdAt: string; id: string };
export class InvalidCursorError extends Error {}

export function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor(value?: string): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as Cursor;
    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      parsed.id.length > 128 ||
      Number.isNaN(Date.parse(parsed.createdAt))
    )
      throw new Error();
    return parsed;
  } catch {
    throw new InvalidCursorError();
  }
}

function outputSummary(value: unknown) {
  try {
    const schema = normalizeOutputSchema(value);
    return schema
      ? {
          enabled: true,
          version: schema.version,
          mode: schema.mode,
          fields: schema.fields.map((field) => ({
            key: field.key,
            type: field.type,
            required: field.required,
          })),
        }
      : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

function publicAgent(agent: any) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    variables: agent.variables.map((variable: any) => ({
      key: variable.key,
      label: variable.label,
      description: variable.description,
      type: variable.type,
      required: variable.required,
    })),
    outputSchema: outputSummary(agent.outputSchema),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export async function getPublicAgent(userId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    include: { variables: { orderBy: { displayOrder: 'asc' } } },
  });
  return agent ? publicAgent(agent) : null;
}

export async function listPublicAgents(
  userId: string,
  input: { limit: number; cursor?: string; status?: string }
) {
  const cursor = decodeCursor(input.cursor);
  const statuses = ['ACTIVE', 'PAUSED', 'FAILED', 'COMPLETED'] as const;
  if (input.status && !statuses.includes(input.status as any))
    throw new InvalidCursorError();
  const rows = await prisma.agent.findMany({
    where: {
      userId,
      ...(input.status ? { status: input.status as any } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: { variables: { orderBy: { displayOrder: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map(publicAgent),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

function publicRun(run: any) {
  return {
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    source: run.source,
    queuedAt: run.queuedAt?.toISOString() ?? null,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    durationMs: run.duration,
    error: run.errorMessage
      ? {
          code: run.lastFailureCode ?? 'EXECUTION_FAILED',
          message: sanitizePersistedExecutionError(run.errorMessage),
        }
      : null,
    structuredStatus: run.structuredStatus,
    resultAvailable: ['VALID', 'PARTIAL'].includes(run.structuredStatus),
    artifactCount: run._count?.artifacts ?? 0,
  };
}

export async function getPublicRun(userId: string, runId: string) {
  const run = await prisma.run.findFirst({
    where: { id: runId, agent: { userId } },
    include: { _count: { select: { artifacts: true } } },
  });
  return run ? publicRun(run) : null;
}

export async function listPublicRuns(
  userId: string,
  input: {
    limit: number;
    cursor?: string;
    status?: string;
    agentId?: string;
    createdAfter?: string;
    createdBefore?: string;
  }
) {
  const cursor = decodeCursor(input.cursor);
  const statuses: RunStatus[] = [
    'QUEUED',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'TIMED_OUT',
    'CANCELED',
  ];
  if (input.status && !statuses.includes(input.status as RunStatus))
    throw new InvalidCursorError();
  const after = input.createdAfter ? new Date(input.createdAfter) : null;
  const before = input.createdBefore ? new Date(input.createdBefore) : null;
  if (
    after &&
    before &&
    (after >= before ||
      before.getTime() - after.getTime() > 366 * 24 * 60 * 60 * 1000)
  )
    throw new InvalidCursorError();
  const where: Prisma.RunWhereInput = {
    agent: { userId },
    ...(input.status ? { status: input.status as RunStatus } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(after || before
      ? {
          createdAt: {
            ...(after ? { gte: after } : {}),
            ...(before ? { lte: before } : {}),
          },
        }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        }
      : {}),
  };
  const rows = await prisma.run.findMany({
    where,
    include: { _count: { select: { artifacts: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map(publicRun),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function getPublicResult(userId: string, runId: string) {
  const run = await prisma.run.findFirst({
    where: { id: runId, agent: { userId } },
    select: {
      id: true,
      structuredStatus: true,
      outputSchemaVersion: true,
      structuredResult: true,
      structuredErrors: true,
      structuredValidatedAt: true,
    },
  });
  if (!run) return null;
  return {
    runId: run.id,
    status: run.structuredStatus,
    schemaVersion: run.outputSchemaVersion,
    data: ['VALID', 'PARTIAL'].includes(run.structuredStatus)
      ? run.structuredResult
      : null,
    errors: ['PARTIAL', 'INVALID', 'PARSE_FAILED', 'TOO_LARGE'].includes(
      run.structuredStatus
    )
      ? run.structuredErrors
      : null,
    validatedAt: run.structuredValidatedAt?.toISOString() ?? null,
  };
}

export async function listPublicArtifacts(userId: string, runId: string) {
  const run = await prisma.run.findFirst({
    where: { id: runId, agent: { userId } },
    select: { id: true },
  });
  if (!run) return null;
  const artifacts = await prisma.runArtifact.findMany({
    where: { runId, type: 'SCREENSHOT' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return artifacts.map((artifact) => ({
    id: artifact.id,
    runId,
    type: artifact.type,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    size: artifact.size,
    createdAt: artifact.createdAt.toISOString(),
    downloadUrl: `/api/v1/artifacts/${encodeURIComponent(artifact.id)}`,
  }));
}
