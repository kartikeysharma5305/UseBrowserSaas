import { UnrecoverableError, type Job } from 'bullmq';

import { prisma } from '@/lib/db/prisma';
import { BrowserExecutionService } from '@/lib/browser/engine';
import { PrismaRunPersistence } from '@/lib/browser/run-persistence';
import { normalizeAgentConfiguration } from '@/lib/execution/agent-configuration';
import {
  EXECUTION_ERROR_DEFINITIONS,
  ExecutionServiceError,
  isRetryableExecutionCode,
  safeSerializeError,
} from '@/lib/execution/errors';
import { isTerminalRunStatus } from '@/lib/execution/run-state';
import { logger } from '@/lib/logger';
import { getRealtimeConfiguration } from '@/lib/realtime/config';
import { RunCancellationError } from '@/lib/runs/cancellation-types';
import { getWorkerArtifactBudget } from '@/lib/usage/quota';
import {
  createRunCostBudget,
  parseRunCostBudget,
} from '@/lib/usage/cost-policy';
import { getPlan } from '@/lib/plans/catalogue';
import {
  browserRunJobSchema,
  type BrowserRunJob,
} from '@/lib/queue/browser-run-job';
import type { QueueConfiguration } from '@/lib/queue/config';

import {
  claimRun,
  failClaimedRun,
  heartbeatRun,
  recordClaimedRunModel,
  releaseRunForRetry,
} from './run-lease';
import { ActiveRunRegistry } from './active-run-registry';
import { normalizeSafetyPolicy } from '@/lib/execution-safety/policy';
import { assertExecutionModelAvailable } from '@/lib/execution/model-catalogue';

export function isRetryableExecutionFailure(
  error: unknown
): error is ExecutionServiceError {
  return (
    error instanceof ExecutionServiceError &&
    isRetryableExecutionCode(error.code)
  );
}

export class BrowserRunProcessor {
  private readonly activeExecutions = new ActiveRunRegistry();
  private readonly persistence = new PrismaRunPersistence();

  constructor(
    private readonly workerId: string,
    private readonly configuration: QueueConfiguration,
    private readonly execution = new BrowserExecutionService()
  ) {}

  async process(job: Job<BrowserRunJob>): Promise<void> {
    const parsedPayload = browserRunJobSchema.safeParse(job.data);
    if (!parsedPayload.success) {
      throw new UnrecoverableError('Invalid browser run job payload.');
    }
    const payload = parsedPayload.data;
    const claimed = await claimRun(
      payload.runId,
      this.workerId,
      this.configuration.leaseMs
    );
    if (!claimed) {
      const run = await prisma.run.findUnique({
        where: { id: payload.runId },
        select: { status: true },
      });
      if (!run || isTerminalRunStatus(run.status)) return;
      throw new Error('Run currently has a valid lease.');
    }

    const abortController = new AbortController();
    const unregister = this.activeExecutions.register(
      claimed.id,
      abortController
    );
    const cancellationIntervalMs =
      getRealtimeConfiguration().cancellationCheckIntervalMs;
    let cancellationCheckInProgress = false;
    const checkCancellation = async () => {
      if (cancellationCheckInProgress || abortController.signal.aborted) return;
      cancellationCheckInProgress = true;
      try {
        const requested = await prisma.run.findFirst({
          where: {
            id: claimed.id,
            status: 'RUNNING',
            workerId: this.workerId,
            cancelRequestedAt: { not: null },
          },
          select: { id: true },
        });
        if (requested) this.activeExecutions.requestCancellation(claimed.id);
      } catch (error) {
        logger.warn('Run cancellation fallback check failed', {
          runId: claimed.id,
          error: safeSerializeError(error),
        });
      } finally {
        cancellationCheckInProgress = false;
      }
    };
    await checkCancellation();
    const cancellationPoll = setInterval(
      () => void checkCancellation(),
      cancellationIntervalMs
    );
    if (abortController.signal.aborted) {
      try {
        await this.persistence.markRunCanceled(
          claimed.id,
          this.workerId,
          claimed.startedAt
        );
      } finally {
        clearInterval(cancellationPoll);
        unregister();
      }
      return;
    }

    let agentConfiguration;
    try {
      agentConfiguration = normalizeAgentConfiguration(
        (claimed.executionConfiguration ??
          claimed.agent.configuration) as Record<string, unknown> | null
      );
      assertExecutionModelAvailable(agentConfiguration.model);
    } catch (error) {
      const providerUnavailable =
        error instanceof Error &&
        error.message.includes('provider is unavailable');
      const failed = await failClaimedRun(
        claimed.id,
        this.workerId,
        providerUnavailable
          ? 'PROVIDER_UNAVAILABLE'
          : 'INVALID_AGENT_CONFIGURATION',
        providerUnavailable
          ? EXECUTION_ERROR_DEFINITIONS.PROVIDER_UNAVAILABLE.message
          : EXECUTION_ERROR_DEFINITIONS.INVALID_AGENT_CONFIGURATION.message
      );
      if (!failed) {
        await this.persistence.markRunCanceled(
          claimed.id,
          this.workerId,
          claimed.startedAt
        );
      }
      logger.warn('Queued run has invalid agent configuration', {
        code: providerUnavailable
          ? 'PROVIDER_UNAVAILABLE'
          : 'INVALID_AGENT_CONFIGURATION',
        runId: claimed.id,
        agentId: claimed.agentId,
        error: safeSerializeError(error),
      });
      clearInterval(cancellationPoll);
      unregister();
      return;
    }
    const recordedModel = await recordClaimedRunModel(
      claimed.id,
      this.workerId,
      claimed.eventStartSequence - 1,
      claimed.attempt,
      agentConfiguration.model
    );
    if (!recordedModel) {
      clearInterval(cancellationPoll);
      unregister();
      return;
    }
    let artifactBudgetBytes: number;
    let artifactBudgetCount: number;
    try {
      const costBudget =
        parseRunCostBudget(claimed.costBudget) ??
        createRunCostBudget(
          getPlan(
            (
              await prisma.user.findUniqueOrThrow({
                where: { id: claimed.agent.userId },
                select: { planCode: true },
              })
            ).planCode
          ),
          agentConfiguration,
          claimed.startedAt
        );
      agentConfiguration = {
        ...agentConfiguration,
        timeoutMs: Math.min(agentConfiguration.timeoutMs, costBudget.timeoutMs),
        maxSteps: Math.min(agentConfiguration.maxSteps, costBudget.maxSteps),
      };
      const quota = await prisma.$transaction((transaction) =>
        getWorkerArtifactBudget(transaction, {
          userId: claimed.agent.userId,
          costBudget,
        })
      );
      artifactBudgetBytes = Number(
        [
          quota.remainingArtifactBytes,
          BigInt(costBudget.maxArtifactBytes),
          BigInt(Number.MAX_SAFE_INTEGER),
        ].reduce((minimum, value) => (value < minimum ? value : minimum))
      );
      artifactBudgetCount = costBudget.maxArtifacts;
    } catch (error) {
      const failure =
        error instanceof ExecutionServiceError
          ? error
          : new ExecutionServiceError('PLAN_CONFIGURATION_INVALID', {
              cause: error,
              stage: 'configuration',
            });
      await failClaimedRun(
        claimed.id,
        this.workerId,
        failure.code,
        failure.publicMessage
      );
      logger.warn('Queued run no longer satisfies plan limits', {
        code: failure.code,
        runId: claimed.id,
        agentId: claimed.agentId,
        error: safeSerializeError(error),
      });
      clearInterval(cancellationPoll);
      unregister();
      return;
    }
    await checkCancellation();
    if (abortController.signal.aborted) {
      try {
        await this.persistence.markRunCanceled(
          claimed.id,
          this.workerId,
          claimed.startedAt
        );
      } finally {
        clearInterval(cancellationPoll);
        unregister();
      }
      return;
    }

    let heartbeatInProgress = false;
    const heartbeat = setInterval(() => {
      if (heartbeatInProgress) return;
      heartbeatInProgress = true;
      void heartbeatRun(claimed.id, this.workerId, this.configuration.leaseMs)
        .then((renewed) => {
          if (!renewed) abortController.abort();
        })
        .catch((error) => {
          logger.error('Run heartbeat failed', {
            code: 'EXECUTION_UNAVAILABLE',
            runId: claimed.id,
            agentId: claimed.agentId,
            stage: 'heartbeat',
            error: safeSerializeError(error),
          });
          abortController.abort();
        })
        .finally(() => {
          heartbeatInProgress = false;
        });
    }, this.configuration.heartbeatMs);

    const finalAttempt = claimed.attempt >= this.configuration.attempts;
    try {
      if (!claimed.executionTask || !claimed.executionTargetWebsite) {
        await failClaimedRun(
          claimed.id,
          this.workerId,
          'INVALID_RUN_INPUT',
          EXECUTION_ERROR_DEFINITIONS.INVALID_RUN_INPUT.message
        );
        return;
      }
      await this.execution.execute({
        runId: claimed.id,
        startedAt: claimed.startedAt,
        agentId: claimed.agentId,
        userId: claimed.agent.userId,
        task: claimed.executionTask,
        targetWebsite: claimed.executionTargetWebsite,
        safetyPolicy: normalizeSafetyPolicy(
          claimed.executionSafetyPolicy as Record<string, unknown> | null,
          claimed.executionTargetWebsite
        ),
        configuration: agentConfiguration,
        finalAttempt,
        signal: abortController.signal,
        eventStartSequence: claimed.eventStartSequence,
        workerId: this.workerId,
        artifactBudgetBytes,
        artifactBudgetCount,
        cleanupTimeoutMs: this.configuration.browserShutdownMs,
      });
    } catch (error) {
      const current = await prisma.run.findUnique({
        where: { id: claimed.id },
        select: { status: true, cancelRequestedAt: true },
      });
      if (current && isTerminalRunStatus(current.status)) return;
      if (error instanceof RunCancellationError || current?.cancelRequestedAt) {
        await this.persistence.markRunCanceled(
          claimed.id,
          this.workerId,
          claimed.startedAt
        );
        return;
      }

      const retryable = isRetryableExecutionFailure(error);
      if (retryable && !finalAttempt) {
        const released = await releaseRunForRetry(
          claimed.id,
          this.workerId,
          error.code
        );
        if (released) throw error;
        return;
      }

      const failure =
        error instanceof ExecutionServiceError
          ? error
          : new ExecutionServiceError('EXECUTION_FAILED', {
              cause: error,
              stage: 'agent_run',
              runId: claimed.id,
            });
      await failClaimedRun(
        claimed.id,
        this.workerId,
        failure.code,
        failure.publicMessage
      );
      logger.error('Queued browser execution failed', {
        code: failure.code,
        runId: claimed.id,
        agentId: claimed.agentId,
        stage: 'agent_run',
        error: safeSerializeError(error),
      });
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancellationPoll);
      unregister();
    }
  }

  abortAll(): void {
    this.activeExecutions.abortAll();
  }

  get activeCount(): number {
    return this.activeExecutions.size;
  }

  async requestCancellation(runId: string): Promise<boolean> {
    if (!this.activeExecutions.has(runId)) return false;
    const requested = await prisma.run.findFirst({
      where: {
        id: runId,
        status: 'RUNNING',
        workerId: this.workerId,
        cancelRequestedAt: { not: null },
      },
      select: { id: true },
    });
    return requested ? this.activeExecutions.requestCancellation(runId) : false;
  }
}
