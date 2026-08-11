import {
  AgentEventType,
  Prisma,
  RunArtifactType,
  RunStatus,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { sanitizePersistedExecutionError } from '@/lib/execution/errors';
import { assertRunStatusTransition } from '@/lib/execution/run-state';
import { sanitizeEventData, toEventJson } from '@/lib/observability/event-data';
import { publishRunNotification } from '@/lib/realtime/run-notifications';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';
import {
  recordArtifactUsage,
  recordTerminalUsage,
  recordUsage,
} from '@/lib/usage/ledger';
import { UsageMeasurement, UsageType, UsageUnit } from '@prisma/client';

import type { PersistedArtifact } from './artifact-persistence';
import type { CollectedEvent } from './event-collector';
import { evaluateStructuredResult } from '@/lib/structured-results';

interface CompletionResult {
  durationMs: number;
  summary: string | null;
  visitedUrls: string[];
  rawResult?: string | null;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
}

interface FinalizeRunInput {
  runId: string;
  startedAt: Date;
  status: 'SUCCESS' | 'FAILED' | 'TIMED_OUT';
  result?: CompletionResult;
  errorMessage?: string;
  failureCode?: string;
  events: CollectedEvent[];
  artifacts: PersistedArtifact[];
}

function toPrismaEventType(type: CollectedEvent['type']): AgentEventType {
  return AgentEventType[type];
}

function terminalEvent(status: FinalizeRunInput['status']) {
  if (status === 'SUCCESS') {
    return {
      type: AgentEventType.RUN_COMPLETED,
      message: 'Run completed successfully.',
    };
  }
  if (status === 'TIMED_OUT') {
    return {
      type: AgentEventType.RUN_FAILED,
      message: 'The agent run exceeded its time limit.',
    };
  }
  return {
    type: AgentEventType.RUN_FAILED,
    message:
      'The agent run failed. Review the run details for more information.',
  };
}

export class PrismaRunPersistence {
  async appendLiveEvent(
    runId: string,
    event: CollectedEvent,
    artifacts: PersistedArtifact[] = []
  ): Promise<boolean> {
    const artifactIds = artifacts.map((artifact) => artifact.id);
    const data = sanitizeEventData({
      ...event.data,
      ...(artifactIds.length > 0 ? { artifactIds } : {}),
    });
    const inserted = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
      `;
      const active = await transaction.run.findFirst({
        where: { id: runId, status: RunStatus.RUNNING },
        select: {
          id: true,
          agent: { select: { userId: true } },
        },
      });
      if (!active) return false;
      const existing = await transaction.agentEvent.findUnique({
        where: { runId_sequence: { runId, sequence: event.sequence } },
        select: { id: true },
      });
      if (existing) return false;
      await transaction.agentEvent.create({
        data: {
          runId,
          sequence: event.sequence,
          type: toPrismaEventType(event.type),
          message: event.message,
          data: toEventJson(data) as Prisma.InputJsonValue,
          timestamp: event.timestamp,
        },
      });
      if (artifacts.length > 0) {
        await transaction.runArtifact.createMany({
          data: artifacts.map((artifact) => ({
            id: artifact.id,
            runId,
            type: RunArtifactType.SCREENSHOT,
            storageProvider: artifact.storageProvider,
            storageKey: artifact.storageKey,
            checksum: artifact.checksum,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
            stepNumber: artifact.stepNumber,
            eventSequence: artifact.eventSequence,
          })),
          skipDuplicates: true,
        });
        for (const artifact of artifacts) {
          await recordArtifactUsage(transaction, {
            userId: active.agent.userId,
            runId,
            artifactId: artifact.id,
            bytes: artifact.size,
            recordedAt: event.timestamp,
          });
        }
      }
      if (event.type === 'STEP_COMPLETED') {
        await recordUsage(transaction, {
          userId: active.agent.userId,
          runId,
          type: UsageType.BROWSER_STEP,
          quantity: 1n,
          unit: UsageUnit.COUNT,
          measurement: UsageMeasurement.EXACT,
          idempotencyKey: `run:${runId}:event:${event.sequence}:browser-step`,
          recordedAt: event.timestamp,
        });
      }
      return true;
    });
    if (inserted) await publishRunNotification(runId);
    return inserted;
  }

  async finalizeRun(input: FinalizeRunInput): Promise<boolean> {
    const completedAt = new Date();
    const durationMs =
      input.result?.durationMs ??
      Math.max(0, completedAt.getTime() - input.startedAt.getTime());
    const safeErrorMessage =
      input.status === 'SUCCESS'
        ? null
        : input.status === 'TIMED_OUT'
          ? 'The agent run exceeded its time limit.'
          : (sanitizePersistedExecutionError(input.errorMessage ?? '') ??
            'The agent run failed. Review the run details for more information.');
    const orderedEvents = [...input.events].sort(
      (left, right) => left.sequence - right.sequence
    );
    const terminal = terminalEvent(input.status);

    const eventRows = orderedEvents.map((event) => {
      const artifactIds = input.artifacts
        .filter((artifact) => artifact.eventSequence === event.sequence)
        .map((artifact) => artifact.id);
      const data = sanitizeEventData({
        ...event.data,
        ...(artifactIds.length > 0 ? { artifactIds } : {}),
      });
      return {
        runId: input.runId,
        sequence: event.sequence,
        type: toPrismaEventType(event.type),
        message: event.message,
        data: toEventJson(data) as Prisma.InputJsonValue,
        timestamp: event.timestamp,
      };
    });

    const finalized = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.runId}, 0))
      `;
      const existing = await transaction.run.findUnique({
        where: { id: input.runId },
        select: {
          status: true,
          cancelRequestedAt: true,
          attempt: true,
          outputSchemaSnapshot: true,
          agent: { select: { userId: true } },
        },
      });
      if (!existing) throw new Error('Run record not found.');
      if (existing.status === input.status) return false;
      if (
        existing.status === RunStatus.CANCELED ||
        Boolean(existing.cancelRequestedAt)
      ) {
        return false;
      }
      assertRunStatusTransition(existing.status, input.status);
      let structured;
      try {
        structured = evaluateStructuredResult(
          input.result?.rawResult,
          existing.outputSchemaSnapshot
        );
      } catch {
        structured = {
          status: 'INVALID' as const,
          raw: null,
          candidate: null,
          result: null,
          errors: [
            {
              path: '$',
              code: 'SCHEMA_INVALID',
              message: 'The stored output schema could not be validated.',
            },
          ],
        };
      }
      const currentMaximum = await transaction.agentEvent.aggregate({
        where: { runId: input.runId },
        _max: { sequence: true },
      });
      const terminalSequence =
        Math.max(
          currentMaximum._max.sequence ?? 0,
          ...orderedEvents.map((event) => event.sequence)
        ) + 1;

      const updated = await transaction.run.updateMany({
        where: {
          id: input.runId,
          status: existing.status,
          cancelRequestedAt: null,
        },
        data: {
          status: RunStatus[input.status],
          completedAt,
          duration: durationMs,
          result:
            input.status === 'SUCCESS' && input.result
              ? {
                  summary: input.result.summary,
                  visitedUrls: input.result.visitedUrls,
                }
              : undefined,
          structuredRawResult:
            structured.raw === null ? undefined : structured.raw,
          structuredCandidate:
            structured.candidate === null
              ? Prisma.DbNull
              : (structured.candidate as Prisma.InputJsonValue),
          structuredResult:
            structured.result === null
              ? Prisma.DbNull
              : (structured.result as Prisma.InputJsonValue),
          structuredStatus: structured.status,
          structuredErrors:
            structured.errors as unknown as Prisma.InputJsonValue,
          structuredValidatedAt:
            structured.status === 'NOT_REQUESTED' ? null : completedAt,
          errorMessage: safeErrorMessage,
          workerId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          lastFailureCode:
            input.status === 'SUCCESS'
              ? null
              : input.status === 'TIMED_OUT'
                ? 'EXECUTION_TIMED_OUT'
                : (input.failureCode ?? 'EXECUTION_FAILED'),
        },
      });
      if (updated.count !== 1) {
        throw new Error('Run status changed during terminal persistence.');
      }

      if (eventRows.length > 0) {
        await transaction.agentEvent.createMany({
          data: eventRows,
          skipDuplicates: true,
        });
      }

      if (input.artifacts.length > 0) {
        await transaction.runArtifact.createMany({
          data: input.artifacts.map((artifact) => ({
            id: artifact.id,
            runId: input.runId,
            type: RunArtifactType.SCREENSHOT,
            storageProvider: artifact.storageProvider,
            storageKey: artifact.storageKey,
            checksum: artifact.checksum,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
            stepNumber: artifact.stepNumber,
            eventSequence: artifact.eventSequence,
          })),
          skipDuplicates: true,
        });
      }
      for (const artifact of input.artifacts) {
        await recordArtifactUsage(transaction, {
          userId: existing.agent.userId,
          runId: input.runId,
          artifactId: artifact.id,
          bytes: artifact.size,
          recordedAt: completedAt,
        });
      }
      for (const event of orderedEvents) {
        if (event.type !== 'STEP_COMPLETED') continue;
        await recordUsage(transaction, {
          userId: existing.agent.userId,
          runId: input.runId,
          type: UsageType.BROWSER_STEP,
          quantity: 1n,
          unit: UsageUnit.COUNT,
          measurement: UsageMeasurement.EXACT,
          idempotencyKey: `run:${input.runId}:event:${event.sequence}:browser-step`,
          recordedAt: event.timestamp,
        });
      }
      await recordTerminalUsage(transaction, {
        userId: existing.agent.userId,
        runId: input.runId,
        status: RunStatus[input.status],
        attempt: existing.attempt,
        durationMs,
        recordedAt: completedAt,
        tokenUsage: input.result?.tokenUsage,
      });

      await transaction.agentEvent.upsert({
        where: {
          runId_sequence: {
            runId: input.runId,
            sequence: terminalSequence,
          },
        },
        create: {
          runId: input.runId,
          sequence: terminalSequence,
          type: terminal.type,
          message:
            input.status === 'SUCCESS'
              ? `Run completed in ${durationMs} ms.`
              : terminal.message,
          data: {
            success: input.status === 'SUCCESS',
            status: input.status,
          },
          timestamp: completedAt,
        },
        update: {},
      });
      return true;
    });
    if (finalized) {
      await publishRunNotification(input.runId);
      await enqueuePendingNotificationDeliveries().catch(() => undefined);
      await enqueuePendingWebhookDeliveries().catch(() => undefined);
    }
    return finalized;
  }

  async markRunCanceled(
    runId: string,
    workerId: string,
    startedAt: Date,
    events: CollectedEvent[] = [],
    artifacts: PersistedArtifact[] = []
  ): Promise<boolean> {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    const orderedEvents = [...events].sort(
      (left, right) => left.sequence - right.sequence
    );
    const canceled = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))
      `;
      const run = await transaction.run.findUnique({
        where: { id: runId },
        select: {
          status: true,
          workerId: true,
          cancelRequestedAt: true,
          attempt: true,
          agent: { select: { userId: true } },
        },
      });
      if (!run || run.status === RunStatus.CANCELED) return false;
      if (
        run.status !== RunStatus.RUNNING ||
        run.workerId !== workerId ||
        run.cancelRequestedAt === null
      ) {
        return false;
      }
      const maximum = await transaction.agentEvent.aggregate({
        where: { runId },
        _max: { sequence: true },
      });
      const terminalSequence =
        Math.max(
          maximum._max.sequence ?? 0,
          ...orderedEvents.map((event) => event.sequence)
        ) + 1;
      const updated = await transaction.run.updateMany({
        where: {
          id: runId,
          status: RunStatus.RUNNING,
          workerId,
          cancelRequestedAt: { not: null },
        },
        data: {
          status: RunStatus.CANCELED,
          canceledAt: completedAt,
          completedAt,
          duration: durationMs,
          errorMessage: null,
          lastFailureCode: null,
          workerId: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) return false;
      if (orderedEvents.length > 0) {
        await transaction.agentEvent.createMany({
          data: orderedEvents.map((event) => ({
            runId,
            sequence: event.sequence,
            type: toPrismaEventType(event.type),
            message: event.message,
            data: toEventJson(event.data) as Prisma.InputJsonValue,
            timestamp: event.timestamp,
          })),
          skipDuplicates: true,
        });
      }
      if (artifacts.length > 0) {
        await transaction.runArtifact.createMany({
          data: artifacts.map((artifact) => ({
            id: artifact.id,
            runId,
            type: RunArtifactType.SCREENSHOT,
            storageProvider: artifact.storageProvider,
            storageKey: artifact.storageKey,
            checksum: artifact.checksum,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
            stepNumber: artifact.stepNumber,
            eventSequence: artifact.eventSequence,
          })),
          skipDuplicates: true,
        });
      }
      for (const artifact of artifacts) {
        await recordArtifactUsage(transaction, {
          userId: run.agent.userId,
          runId,
          artifactId: artifact.id,
          bytes: artifact.size,
          recordedAt: completedAt,
        });
      }
      for (const event of orderedEvents) {
        if (event.type !== 'STEP_COMPLETED') continue;
        await recordUsage(transaction, {
          userId: run.agent.userId,
          runId,
          type: UsageType.BROWSER_STEP,
          quantity: 1n,
          unit: UsageUnit.COUNT,
          measurement: UsageMeasurement.EXACT,
          idempotencyKey: `run:${runId}:event:${event.sequence}:browser-step`,
          recordedAt: event.timestamp,
        });
      }
      await recordTerminalUsage(transaction, {
        userId: run.agent.userId,
        runId,
        status: RunStatus.CANCELED,
        attempt: run.attempt,
        durationMs,
        recordedAt: completedAt,
      });
      await transaction.agentEvent.create({
        data: {
          runId,
          sequence: terminalSequence,
          type: AgentEventType.RUN_CANCELED,
          message: 'Run canceled.',
          data: { status: 'CANCELED', success: false },
          timestamp: completedAt,
        },
      });
      return true;
    });
    if (canceled) {
      await publishRunNotification(runId);
      await enqueuePendingNotificationDeliveries().catch(() => undefined);
      await enqueuePendingWebhookDeliveries().catch(() => undefined);
    }
    return canceled;
  }

  async markRunFailed(
    runId: string,
    startedAt: Date,
    errorMessage: string,
    events: CollectedEvent[] = [],
    artifacts: PersistedArtifact[] = [],
    failureCode?: string
  ): Promise<boolean> {
    return this.finalizeRun({
      runId,
      startedAt,
      status: 'FAILED',
      errorMessage,
      events,
      artifacts,
      failureCode,
    });
  }

  async markRunTimedOut(
    runId: string,
    startedAt: Date,
    events: CollectedEvent[] = [],
    artifacts: PersistedArtifact[] = []
  ): Promise<boolean> {
    return this.finalizeRun({
      runId,
      startedAt,
      status: 'TIMED_OUT',
      errorMessage: 'The agent run exceeded its time limit.',
      events,
      artifacts,
    });
  }
}
