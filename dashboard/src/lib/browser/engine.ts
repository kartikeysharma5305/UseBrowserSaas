import { getArtifactMaxBytesPerRun } from '@/lib/execution/configuration';
import {
  ExecutionServiceError,
  isRetryableExecutionCode,
  safeSerializeError,
  type ExecutionErrorCode,
  type ExecutionStage,
} from '@/lib/execution/errors';
import {
  ExecutionTimeoutError,
  ExecutionAbortedError,
  waitForCleanup,
  withWallClockTimeout,
} from '@/lib/execution/timeout';
import type { AgentExecutionResult } from '@/lib/execution/types';
import { logger } from '@/lib/logger';
import {
  normalizeEventUrl,
  truncateEventText,
} from '@/lib/observability/event-data';
import { RunCancellationError } from '@/lib/runs/cancellation-types';
import type { ExecutionSafetyPolicy } from '@/lib/execution-safety/types';
import {
  SAFETY_FAILURE_CODES,
  SafetyPolicyError,
} from '@/lib/execution-safety/types';
import {
  ExecutionSafetyGuard,
  installExecutionSafetyGuard,
} from '@/lib/execution-safety/runtime-guard';
import { safeEngineDomainPatterns } from '@/lib/execution-safety/domain-policy';
import { NetworkResolutionError } from '@/lib/execution-safety/network';
import { recordProviderRunOutcome } from '@/lib/operations/signals';

import {
  buildScreenshotCandidates,
  deletePersistedArtifacts,
  persistScreenshotCandidates,
  type PersistedArtifact,
} from './artifact-persistence';
import { EngineLoader } from './engine-loader';
import { EventCollector } from './event-collector';
import { PrismaRunPersistence } from './run-persistence';

export interface BrowserExecutionInput {
  runId?: string;
  startedAt?: Date;
  agentId: string;
  userId: string;
  task: string;
  targetWebsite?: string;
  safetyPolicy?: ExecutionSafetyPolicy;
  configuration: {
    model: string;
    provider?: 'groq' | 'nvidia';
    providerModel?: string;
    maxSteps: number;
    timeoutMs: number;
    browserSettings: {
      headless: boolean;
      viewportWidth: number;
      viewportHeight: number;
      useVision?: boolean;
    };
  };
  finalAttempt?: boolean;
  signal?: AbortSignal;
  eventStartSequence?: number;
  workerId?: string;
  artifactBudgetBytes?: number;
  artifactBudgetCount?: number;
  cleanupTimeoutMs?: number;
}

interface AgentHistoryLike {
  urls?: () => unknown;
  screenshots?: () => unknown;
  screenshot_paths?: () => unknown;
  final_result?: () => unknown;
  is_successful?: () => unknown;
  errors?: () => unknown;
  number_of_steps?: () => unknown;
  usage?: unknown;
}

interface BrowserSessionLike {
  close: () => Promise<void>;
}

interface AgentLike {
  eventbus: {
    on: (
      name: string,
      handler: (event: unknown) => void
    ) => void | (() => void);
  };
  run: (maxSteps: number) => Promise<unknown>;
  stop?: () => void;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function providerTokenUsage(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.total_prompt_tokens;
  const outputTokens = usage.total_completion_tokens;
  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    (inputTokens as number) < 0 ||
    (outputTokens as number) < 0
  ) {
    return null;
  }
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: (inputTokens as number) + (outputTokens as number),
  };
}

export function providerFailureCode(value: unknown): ExecutionErrorCode | null {
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const status = Number(record?.statusCode ?? record?.status ?? NaN);
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : typeof record?.message === 'string'
          ? record.message
          : '';
  if (
    status === 429 ||
    /\b429\b|rate[_ -]?limit|\bquota\b|tokens per (?:day|minute)/i.test(message)
  )
    return 'PROVIDER_RATE_LIMITED';
  if (
    [401, 403].includes(status) ||
    /\b(?:401|403)\b|unauthorized|invalid api key|authentication/i.test(message)
  )
    return 'PROVIDER_AUTH_FAILED';
  if (
    status === 404 ||
    /\b404\b|model (?:is )?not (?:found|available)|unknown model/i.test(message)
  )
    return 'PROVIDER_MODEL_UNAVAILABLE';
  if (/timeout|timed out|aborterror|etimedout/i.test(message))
    return 'PROVIDER_TIMEOUT';
  if (
    status >= 500 ||
    /service unavailable|bad gateway|econnreset|econnrefused/i.test(message)
  )
    return 'PROVIDER_UNAVAILABLE';
  if (
    /malformed|invalid json|json.*(?:parse|syntax)|unusable response/i.test(
      message
    )
  )
    return 'PROVIDER_BAD_RESPONSE';
  return null;
}

function unsuccessfulHistoryCode(
  history: AgentHistoryLike,
  maxSteps: number
): ExecutionErrorCode {
  const errors = stringArray(history.errors?.());
  for (const error of errors) {
    const code = providerFailureCode(error);
    if (code) return code;
  }

  const numberOfSteps = history.number_of_steps?.();
  if (
    typeof numberOfSteps === 'number' &&
    Number.isSafeInteger(numberOfSteps) &&
    numberOfSteps >= maxSteps
  ) {
    return 'EXECUTION_STEP_LIMIT_EXCEEDED';
  }

  return 'EXECUTION_FAILED';
}

function executionFailure(
  error: unknown,
  stage: ExecutionStage,
  runId: string
): ExecutionServiceError {
  if (error instanceof ExecutionServiceError) return error;
  if (error instanceof SafetyPolicyError) {
    return new ExecutionServiceError(error.code, {
      cause: error,
      stage: 'agent_run',
      runId,
    });
  }
  if (error instanceof NetworkResolutionError) {
    return new ExecutionServiceError('NETWORK_RESOLUTION_FAILED', {
      cause: error,
      stage: 'agent_run',
      runId,
    });
  }
  if (error instanceof ExecutionTimeoutError) {
    return new ExecutionServiceError('EXECUTION_TIMED_OUT', {
      cause: error,
      stage: 'timeout',
      runId,
    });
  }
  if (error instanceof ExecutionAbortedError) {
    return new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
      cause: error,
      stage: 'heartbeat',
      runId,
    });
  }
  const providerCode = providerFailureCode(error);
  if (providerCode) {
    return new ExecutionServiceError(providerCode, {
      cause: error,
      stage,
      runId,
    });
  }
  const unavailableStages: ExecutionStage[] = [
    'engine_load',
    'llm_create',
    'browser_start',
  ];
  return new ExecutionServiceError(
    unavailableStages.includes(stage)
      ? 'EXECUTION_UNAVAILABLE'
      : 'EXECUTION_FAILED',
    { cause: error, stage, runId }
  );
}

export class BrowserExecutionService {
  private readonly engineLoader = new EngineLoader();
  private readonly persistence = new PrismaRunPersistence();

  private logFailure(
    message: string,
    input: BrowserExecutionInput,
    failure: ExecutionServiceError
  ) {
    logger.error(message, {
      code: failure.code,
      agentId: input.agentId,
      runId: failure.runId,
      stage: failure.stage,
      error: safeSerializeError(
        failure.cause === undefined ? failure : failure.cause
      ),
    });
  }

  async execute(input: BrowserExecutionInput): Promise<AgentExecutionResult> {
    const runId = input.runId ?? randomUUID();
    const startedAt = input.startedAt ?? new Date();
    let maxArtifactBytes: number;
    const maxArtifacts = Math.max(
      0,
      input.artifactBudgetCount ?? Number.MAX_SAFE_INTEGER
    );

    try {
      maxArtifactBytes = Math.min(
        getArtifactMaxBytesPerRun(),
        input.artifactBudgetBytes ?? Number.MAX_SAFE_INTEGER
      );
    } catch (error) {
      throw new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
        cause: error,
        stage: 'configuration',
      });
    }

    const liveArtifacts: PersistedArtifact[] = [];
    let liveArtifactBytes = 0;
    const collector = new EventCollector(
      input.eventStartSequence ?? 3,
      async (event) => {
        let eventArtifacts: PersistedArtifact[] = [];
        if (
          event.screenshot &&
          liveArtifactBytes < maxArtifactBytes &&
          liveArtifacts.length < maxArtifacts
        ) {
          eventArtifacts = await persistScreenshotCandidates(
            runId,
            [event.screenshot],
            undefined,
            maxArtifactBytes - liveArtifactBytes,
            maxArtifacts - liveArtifacts.length
          );
        }
        try {
          const inserted = await this.persistence.appendLiveEvent(
            runId,
            event,
            eventArtifacts
          );
          if (!inserted) {
            await deletePersistedArtifacts(eventArtifacts);
            return;
          }
          liveArtifacts.push(...eventArtifacts);
          liveArtifactBytes += eventArtifacts.reduce(
            (total, artifact) => total + artifact.size,
            0
          );
        } catch (error) {
          await deletePersistedArtifacts(eventArtifacts);
          throw error;
        }
      }
    );
    let stage: ExecutionStage = 'engine_load';
    let browserSession: BrowserSessionLike | null = null;
    let agent: AgentLike | null = null;
    let history: AgentHistoryLike | null = null;
    let primaryFailure: ExecutionServiceError | null = null;
    let cancellation: RunCancellationError | null = null;
    let closePromise: Promise<void> | null = null;

    const closeBrowserOnce = () => {
      if (!closePromise) {
        closePromise = browserSession
          ? browserSession.close()
          : Promise.resolve();
      }
      return closePromise;
    };

    try {
      const safetyGuard =
        input.safetyPolicy && input.targetWebsite
          ? new ExecutionSafetyGuard(input.safetyPolicy, input.targetWebsite)
          : null;
      if (safetyGuard && input.targetWebsite)
        await safetyGuard.assertNavigation(input.targetWebsite, 'initial');
      const modules = await this.engineLoader.loadEngineModules();
      const AgentClass = modules.AgentClass as new (opts: unknown) => AgentLike;
      const BrowserProfileClass = modules.BrowserProfileClass as new (
        opts: unknown
      ) => unknown;
      const BrowserSessionClass = modules.BrowserSessionClass as new (
        opts: unknown
      ) => BrowserSessionLike;
      const getLlmByName = modules.getLlmByName as (
        modelName: string
      ) => unknown;

      stage = 'llm_create';
      const llm = getLlmByName(input.configuration.model);

      stage = 'browser_start';
      const engineDomains = input.safetyPolicy
        ? safeEngineDomainPatterns(input.safetyPolicy)
        : null;
      const browserProfile = new BrowserProfileClass({
        headless: input.configuration.browserSettings.headless,
        viewport: {
          width: input.configuration.browserSettings.viewportWidth,
          height: input.configuration.browserSettings.viewportHeight,
        },
        ...(engineDomains
          ? {
              allowed_domains: engineDomains.allowed,
              prohibited_domains: engineDomains.blocked,
              block_ip_addresses: true,
              accept_downloads: false,
              downloads_path: null,
            }
          : {}),
      });
      browserSession = new BrowserSessionClass({
        browser_profile: browserProfile,
      });
      if (safetyGuard)
        installExecutionSafetyGuard(
          browserSession as unknown as Record<string, unknown>,
          safetyGuard
        );
      agent = new AgentClass({
        task: input.task,
        llm,
        browser_session: browserSession,
        source: 'dashboard',
        use_vision: input.configuration.browserSettings.useVision ?? true,
        register_signal_handlers: false,
      });
      collector.attach(agent);

      stage = 'agent_run';
      history = (await withWallClockTimeout(
        () => agent!.run(input.configuration.maxSteps),
        input.configuration.timeoutMs,
        () => {
          try {
            agent?.stop?.();
          } catch (error) {
            logger.warn('Cooperative agent stop failed', {
              agentId: input.agentId,
              runId,
              stage: 'timeout',
              error: safeSerializeError(error),
            });
          }
          void closeBrowserOnce().catch(() => undefined);
        },
        input.signal
      )) as AgentHistoryLike;
    } catch (error) {
      if (error instanceof RunCancellationError) {
        cancellation = error;
      } else {
        primaryFailure = executionFailure(error, stage, runId);
        this.logFailure(
          'Agent execution did not complete',
          input,
          primaryFailure
        );
      }
    } finally {
      collector.detach();
      try {
        await collector.flush();
      } catch (error) {
        if (!primaryFailure && !cancellation) {
          primaryFailure = new ExecutionServiceError('EXECUTION_FAILED', {
            cause: error,
            stage: 'run_persistence',
            runId,
          });
        }
      }
      let cleanupError: unknown;
      const cleanup = closeBrowserOnce().catch((error) => {
        cleanupError = error;
      });
      const cleanedWithinGrace = await waitForCleanup(
        cleanup,
        input.cleanupTimeoutMs
      );
      if (!cleanedWithinGrace) {
        logger.warn('Browser cleanup exceeded its grace period', {
          agentId: input.agentId,
          runId,
          stage: 'cleanup',
        });
      }
      if (cleanupError) {
        logger.warn('Browser cleanup failed', {
          agentId: input.agentId,
          runId,
          stage: 'cleanup',
          error: safeSerializeError(cleanupError),
        });
      }
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    const collectedEvents = collector.drain();
    const visitedUrls = stringArray(history?.urls?.())
      .map(normalizeEventUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 200);
    const historyScreenshots = stringArray(history?.screenshots?.()).slice(
      0,
      200
    );
    const historyScreenshotPaths = stringArray(
      history?.screenshot_paths?.()
    ).slice(0, 200);
    let pendingArtifacts: PersistedArtifact[] = [];

    try {
      const liveEventSequences = new Set(
        liveArtifacts
          .map((artifact) => artifact.eventSequence)
          .filter((sequence): sequence is number => sequence !== null)
      );
      const remainingCandidates = buildScreenshotCandidates(
        collectedEvents,
        historyScreenshots,
        historyScreenshotPaths
      ).filter(
        (candidate) =>
          candidate.kind !== 'data-url' &&
          (candidate.eventSequence === null ||
            !liveEventSequences.has(candidate.eventSequence))
      );
      pendingArtifacts = await persistScreenshotCandidates(
        runId,
        remainingCandidates,
        undefined,
        Math.max(0, maxArtifactBytes - liveArtifactBytes),
        Math.max(0, maxArtifacts - liveArtifacts.length)
      );
    } catch (error) {
      logger.warn('Run artifact collection failed', {
        runId,
        agentId: input.agentId,
        error: safeSerializeError(error),
      });
    }

    const finalResult = history?.final_result?.();
    const summary = truncateEventText(finalResult, 4000) ?? null;
    const tokenUsage = providerTokenUsage(history?.usage);
    if (
      !primaryFailure &&
      !cancellation &&
      history?.is_successful?.() !== true
    ) {
      primaryFailure = new ExecutionServiceError(
        unsuccessfulHistoryCode(history!, input.configuration.maxSteps),
        {
          stage: 'agent_result',
          runId,
        }
      );
      this.logFailure(
        'Agent reported an unsuccessful result',
        input,
        primaryFailure
      );
    }

    const provider =
      input.configuration.provider ??
      (input.configuration.model.startsWith('nvidia_') ? 'nvidia' : 'groq');
    if (!cancellation)
      recordProviderRunOutcome(provider, primaryFailure?.code ?? null);

    if (
      primaryFailure &&
      isRetryableExecutionCode(primaryFailure.code) &&
      input.finalAttempt === false
    ) {
      await deletePersistedArtifacts(pendingArtifacts);
      throw primaryFailure;
    }

    const artifacts = [...liveArtifacts, ...pendingArtifacts];
    try {
      if (cancellation) {
        if (!input.workerId) {
          throw new Error(
            'Worker identity is required to persist cancellation.'
          );
        }
        await this.persistence.markRunCanceled(
          runId,
          input.workerId,
          startedAt,
          collectedEvents,
          artifacts
        );
      } else if (primaryFailure?.code === 'EXECUTION_TIMED_OUT') {
        const finalized = await this.persistence.markRunTimedOut(
          runId,
          startedAt,
          collectedEvents,
          artifacts
        );
        if (!finalized && input.workerId) {
          await this.persistence.markRunCanceled(
            runId,
            input.workerId,
            startedAt,
            collectedEvents,
            artifacts
          );
        }
      } else if (primaryFailure) {
        const shouldPersistFailureCode =
          SAFETY_FAILURE_CODES.includes(
            primaryFailure.code as (typeof SAFETY_FAILURE_CODES)[number]
          ) ||
          primaryFailure.code === 'NETWORK_RESOLUTION_FAILED' ||
          primaryFailure.code === 'AI_PROVIDER_RATE_LIMITED' ||
          primaryFailure.code.startsWith('PROVIDER_') ||
          primaryFailure.code === 'EXECUTION_STEP_LIMIT_EXCEEDED';
        const finalized = shouldPersistFailureCode
          ? await this.persistence.markRunFailed(
              runId,
              startedAt,
              primaryFailure.publicMessage,
              collectedEvents,
              artifacts,
              primaryFailure.code
            )
          : await this.persistence.markRunFailed(
              runId,
              startedAt,
              primaryFailure.publicMessage,
              collectedEvents,
              artifacts
            );
        if (!finalized && input.workerId) {
          await this.persistence.markRunCanceled(
            runId,
            input.workerId,
            startedAt,
            collectedEvents,
            artifacts
          );
        }
      } else {
        const finalized = await this.persistence.finalizeRun({
          runId,
          startedAt,
          status: 'SUCCESS',
          result: {
            durationMs,
            summary,
            rawResult:
              typeof finalResult === 'string'
                ? finalResult
                : finalResult == null
                  ? null
                  : JSON.stringify(finalResult),
            visitedUrls,
            tokenUsage,
          },
          events: collectedEvents,
          artifacts,
        });
        if (!finalized && input.workerId) {
          await this.persistence.markRunCanceled(
            runId,
            input.workerId,
            startedAt,
            collectedEvents,
            artifacts
          );
        }
      }
    } catch (error) {
      await deletePersistedArtifacts(pendingArtifacts);
      const failure = new ExecutionServiceError('EXECUTION_FAILED', {
        cause: error,
        stage: 'run_persistence',
        runId,
      });
      this.logFailure('Run terminal transaction failed', input, failure);
      throw failure;
    }

    if (cancellation) throw cancellation;
    if (primaryFailure) throw primaryFailure;

    logger.info('Run execution finished', {
      runId,
      status: 'completed',
      durationMs,
      eventCount: collectedEvents.length + 2,
      artifactCount: artifacts.length,
    });

    return {
      runId,
      status: 'completed',
      startedAt,
      completedAt,
      durationMs,
      summary,
      visitedUrls,
      eventCount: collectedEvents.length + 2,
      artifactCount: artifacts.length,
      detailsUrl: `/dashboard/runs/${runId}`,
    };
  }
}
import { randomUUID } from 'node:crypto';
