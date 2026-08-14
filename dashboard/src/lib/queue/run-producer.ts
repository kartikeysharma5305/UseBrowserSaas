import { randomUUID } from 'node:crypto';

import { AgentEventType, Prisma, RunStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { normalizeAgentConfiguration } from '@/lib/execution/agent-configuration';
import {
  ExecutionServiceError,
  safeSerializeError,
} from '@/lib/execution/errors';
import { logger } from '@/lib/logger';
import { recordUsage } from '@/lib/usage/ledger';
import { recordTerminalUsage } from '@/lib/usage/ledger';
import { enforceAdmissionQuota } from '@/lib/usage/quota';
import { UsageMeasurement, UsageType, UsageUnit } from '@prisma/client';

import {
  assertQueueHasCapacity,
  enqueueBrowserRun,
  getBrowserRunQueue,
} from './browser-run-queue';
import { getQueueConfiguration } from './config';
import type { AgentExecutionInput } from '@/lib/execution/types';
import { getSchedulingEntitlement } from '@/lib/scheduling/entitlement';
import { enqueuePendingNotificationDeliveries } from '@/lib/notifications/queue';
import { createScheduleWebhookEvent } from '@/lib/webhooks/events';
import { enqueuePendingWebhookDeliveries } from '@/lib/webhooks/queue';
import {
  resolveAgentInput,
  VariableResolutionError,
} from '@/lib/variables/resolver';
import { protectRunSecrets } from '@/lib/variables/run-secrets';
import {
  normalizeSafetyPolicy,
  safetyPolicyInput,
} from '@/lib/execution-safety/policy';
import { assertStaticUrlAllowed } from '@/lib/execution-safety/domain-policy';
import {
  normalizeOutputSchema,
  structuredOutputInstruction,
} from '@/lib/structured-results';
import { enforceRunAdmissionSecurity } from '@/lib/security/run-admission';
import { isExecutionAdmissionEnabled } from '@/lib/security/policy';
import { assertExecutionModelAvailable } from '@/lib/execution/model-catalogue';

export interface EnqueuedRun {
  runId: string;
  status: 'QUEUED';
  detailsUrl: string;
}

class QueueAdmissionError extends Error {
  constructor(
    readonly code: 'AGENT_RUN_ALREADY_ACTIVE' | 'USER_RUN_LIMIT_REACHED',
    readonly activeRunId?: string
  ) {
    super(code);
  }
}

async function reserveQueuedRun(
  input: AgentExecutionInput,
  runId: string
): Promise<void> {
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))
      `;

      const agent = await transaction.agent.findFirst({
        where: { id: input.agentId, userId: input.userId },
        select: {
          id: true,
          goal: true,
          targetWebsite: true,
          configuration: true,
          status: true,
          variableVersion: true,
          safetyPolicy: true,
          outputSchema: true,
          variables: { orderBy: { displayOrder: 'asc' } },
        },
      });
      if (!agent) {
        throw new ExecutionServiceError('AGENT_NOT_FOUND', {
          stage: 'agent_lookup',
        });
      }

      const owner = await transaction.user.findUnique({
        where: { id: input.userId },
        select: {
          planCode: true,
          betaAccessStatus: true,
          accountDeletion: { select: { status: true } },
        },
      });
      if (
        !owner ||
        ['PENDING', 'FAILED'].includes(owner.accountDeletion?.status ?? '')
      )
        throw new ExecutionServiceError('ACCOUNT_DELETION_IN_PROGRESS', {
          stage: input.scheduled ? 'schedule_admission' : 'run_create',
        });
      if (
        owner.betaAccessStatus === 'SUSPENDED' ||
        owner.betaAccessStatus === 'ENDED'
      )
        throw new ExecutionServiceError('BETA_ACCESS_SUSPENDED', {
          stage: input.scheduled ? 'schedule_admission' : 'run_create',
        });

      let suppliedVariables: Record<string, string | number | boolean> =
        input.variables ?? {};
      if (input.scheduled) {
        const occurrence = await transaction.scheduledOccurrence.findUnique({
          where: { id: input.scheduled.occurrenceId },
          include: {
            schedule: {
              select: {
                id: true,
                userId: true,
                agentId: true,
                state: true,
                variableValues: true,
                configurationErrorCode: true,
              },
            },
          },
        });
        if (
          !occurrence ||
          occurrence.status !== 'DISCOVERED' ||
          occurrence.runId ||
          occurrence.scheduledFor.getTime() !==
            input.scheduled.scheduledFor.getTime() ||
          occurrence.schedule.id !== input.scheduled.scheduleId ||
          occurrence.schedule.userId !== input.userId ||
          occurrence.schedule.agentId !== input.agentId ||
          occurrence.schedule.configurationErrorCode !== null ||
          agent.status !== 'ACTIVE'
        ) {
          throw new ExecutionServiceError('AGENT_SCHEDULING_DISABLED', {
            stage: 'schedule_admission',
          });
        }
        if (!getSchedulingEntitlement(owner.planCode).enabled)
          throw new ExecutionServiceError('SCHEDULING_NOT_AVAILABLE', {
            stage: 'schedule_admission',
          });
        suppliedVariables = occurrence.schedule.variableValues as Record<
          string,
          string | number | boolean
        >;
      }

      const activeForAgent = await transaction.run.findFirst({
        where: {
          agentId: input.agentId,
          status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
        },
        select: { id: true },
      });
      if (activeForAgent) {
        throw new QueueAdmissionError(
          'AGENT_RUN_ALREADY_ACTIVE',
          activeForAgent.id
        );
      }

      const queuedAt = new Date();
      await enforceRunAdmissionSecurity(transaction, {
        userId: input.userId,
        agentId: input.agentId,
        now: queuedAt,
      });
      let resolved;
      try {
        resolved = resolveAgentInput({
          goal: agent.goal,
          targetWebsite: agent.targetWebsite,
          definitions: agent.variables,
          supplied: suppliedVariables,
          definitionVersion: agent.variableVersion,
        });
      } catch (error) {
        if (error instanceof VariableResolutionError)
          throw new ExecutionServiceError(
            error.code === 'SECRET_VARIABLE_UNAVAILABLE'
              ? 'SECRET_VARIABLES_UNAVAILABLE'
              : 'INVALID_RUN_INPUT',
            { stage: input.scheduled ? 'schedule_admission' : 'run_create' }
          );
        throw error;
      }
      const configuration = normalizeAgentConfiguration(
        agent.configuration as Record<string, unknown> | null
      );
      try {
        assertExecutionModelAvailable(configuration.model);
      } catch (error) {
        throw new ExecutionServiceError('PROVIDER_UNAVAILABLE', {
          cause: error,
          stage: input.scheduled ? 'schedule_admission' : 'run_create',
        });
      }
      let safetyPolicy;
      let outputSchema;
      let secretEnvelope;
      try {
        safetyPolicy = normalizeSafetyPolicy(
          agent.safetyPolicy,
          resolved.targetWebsite
        );
        assertStaticUrlAllowed(resolved.targetWebsite, safetyPolicy);
        secretEnvelope = protectRunSecrets(
          resolved.secretValues,
          runId,
          input.agentId
        );
        outputSchema = normalizeOutputSchema(agent.outputSchema);
      } catch (error) {
        throw new ExecutionServiceError('INVALID_AGENT_CONFIGURATION', {
          cause: error,
          stage: input.scheduled ? 'schedule_admission' : 'run_create',
        });
      }
      if (outputSchema) {
        resolved = {
          ...resolved,
          task: `${resolved.task}${structuredOutputInstruction(outputSchema)}`,
        };
      }
      const quota = await enforceAdmissionQuota(transaction, {
        userId: input.userId,
        configuration,
        now: queuedAt,
      });
      await transaction.run.create({
        data: {
          id: runId,
          agentId: input.agentId,
          status: RunStatus.QUEUED,
          source: input.scheduled ? 'SCHEDULED' : (input.source ?? 'MANUAL'),
          queueJobId: runId,
          queuedAt,
          startedAt: queuedAt,
          inputSnapshot: {
            ...resolved.snapshot,
            ...(secretEnvelope ? { secretEnvelope } : {}),
          } as unknown as Prisma.InputJsonValue,
          executionTask: resolved.task,
          executionTargetWebsite: resolved.targetWebsite,
          executionConfiguration:
            configuration as unknown as Prisma.InputJsonValue,
          costBudget: quota.costBudget as unknown as Prisma.InputJsonValue,
          executionSafetyPolicy: safetyPolicyInput(safetyPolicy),
          outputSchemaSnapshot:
            outputSchema as unknown as Prisma.InputJsonValue,
          outputSchemaVersion: outputSchema?.version,
          structuredStatus: outputSchema ? 'PENDING' : 'NOT_REQUESTED',
        },
      });
      if (input.scheduled) {
        const linked = await transaction.scheduledOccurrence.updateMany({
          where: {
            id: input.scheduled.occurrenceId,
            status: 'DISCOVERED',
            runId: null,
          },
          data: {
            status: 'ADMITTED',
            runId,
            resolvedAt: queuedAt,
            processingLeaseUntil: null,
            errorCode: null,
          },
        });
        if (linked.count !== 1)
          throw new ExecutionServiceError('AGENT_SCHEDULING_DISABLED', {
            stage: 'schedule_admission',
          });
        await createScheduleWebhookEvent(transaction, {
          userId: input.userId,
          scheduleId: input.scheduled.scheduleId,
          occurrenceId: input.scheduled.occurrenceId,
          status: 'ADMITTED',
          runId,
          recordedAt: queuedAt,
        });
      }
      await transaction.agentEvent.create({
        data: {
          runId,
          sequence: 1,
          type: AgentEventType.RUN_CREATED,
          message: 'Run queued for browser execution.',
          data: { status: 'QUEUED' },
        },
      });
      await recordUsage(transaction, {
        userId: input.userId,
        runId,
        type: UsageType.RUN_ADMITTED,
        quantity: 1n,
        unit: UsageUnit.COUNT,
        measurement: UsageMeasurement.EXACT,
        idempotencyKey: `run:${runId}:admitted`,
        recordedAt: queuedAt,
      });
    });
  } catch (error) {
    if (error instanceof ExecutionServiceError) throw error;
    if (error instanceof QueueAdmissionError) {
      throw new ExecutionServiceError(error.code, {
        stage: 'queue_reserve',
        activeRunId: error.activeRunId,
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const active = await prisma.run.findFirst({
        where: {
          agentId: input.agentId,
          status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
        },
        select: { id: true },
      });
      throw new ExecutionServiceError('AGENT_RUN_ALREADY_ACTIVE', {
        stage: 'queue_reserve',
        activeRunId: active?.id,
      });
    }
    throw error;
  }
}

export class PrismaRunProducer {
  async enqueue(input: AgentExecutionInput): Promise<EnqueuedRun> {
    if (!isExecutionAdmissionEnabled())
      throw new ExecutionServiceError('EXECUTION_DISABLED', {
        stage: input.scheduled ? 'schedule_admission' : 'queue_reserve',
      });
    const configuration = getQueueConfiguration();
    const queue = getBrowserRunQueue();
    const runId = input.scheduled
      ? `scheduled-${input.scheduled.occurrenceId}`
      : (input.trustedRunId ?? randomUUID());

    if (input.trustedRunId) {
      const existing = await prisma.run.findFirst({
        where: {
          id: runId,
          agentId: input.agentId,
          agent: { userId: input.userId },
        },
        select: { id: true },
      });
      if (existing) {
        await enqueueBrowserRun(queue, runId);
        return {
          runId,
          status: 'QUEUED',
          detailsUrl: `/dashboard/runs/${runId}`,
        };
      }
    }

    try {
      await assertQueueHasCapacity(queue, configuration);
    } catch (error) {
      if (error instanceof ExecutionServiceError) throw error;
      throw new ExecutionServiceError('QUEUE_UNAVAILABLE', {
        cause: error,
        stage: 'queue_reserve',
      });
    }

    try {
      await reserveQueuedRun(input, runId);
    } catch (error) {
      if (!input.trustedRunId) throw error;
      const existing = await prisma.run.findFirst({
        where: {
          id: runId,
          agentId: input.agentId,
          agent: { userId: input.userId },
        },
        select: { id: true },
      });
      if (!existing) throw error;
    }
    await enqueuePendingNotificationDeliveries().catch(() => undefined);
    await enqueuePendingWebhookDeliveries().catch(() => undefined);

    try {
      await enqueueBrowserRun(queue, runId);
    } catch (error) {
      const message = 'The agent run could not be queued. Try again later.';
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.run.updateMany({
          where: { id: runId, status: RunStatus.QUEUED },
          data: {
            status: RunStatus.FAILED,
            completedAt: new Date(),
            errorMessage: message,
            lastFailureCode: 'RUN_ENQUEUE_FAILED',
          },
        });
        if (updated.count === 1) {
          if (input.scheduled) {
            await transaction.scheduledOccurrence.updateMany({
              where: { id: input.scheduled.occurrenceId, runId },
              data: {
                status: 'FAILED',
                resolvedAt: new Date(),
                processingLeaseUntil: null,
                errorCode: 'RUN_ENQUEUE_FAILED',
              },
            });
          }
          await transaction.agentEvent.create({
            data: {
              runId,
              sequence: 2,
              type: AgentEventType.RUN_FAILED,
              message,
              data: { code: 'RUN_ENQUEUE_FAILED', success: false },
            },
          });
          await recordTerminalUsage(transaction, {
            userId: input.userId,
            runId,
            status: RunStatus.FAILED,
            attempt: 0,
            durationMs: 0,
          });
        }
      });
      logger.error('Browser run enqueue failed', {
        code: 'RUN_ENQUEUE_FAILED',
        runId,
        agentId: input.agentId,
        stage: 'queue_enqueue',
        error: safeSerializeError(error),
      });
      await enqueuePendingNotificationDeliveries().catch(() => undefined);
      await enqueuePendingWebhookDeliveries().catch(() => undefined);
      throw new ExecutionServiceError('RUN_ENQUEUE_FAILED', {
        cause: error,
        stage: 'queue_enqueue',
        runId,
      });
    }

    logger.info('Browser run queued', {
      runId,
      agentId: input.agentId,
      queue: configuration.queueName,
    });
    return {
      runId,
      status: 'QUEUED',
      detailsUrl: `/dashboard/runs/${runId}`,
    };
  }
}
