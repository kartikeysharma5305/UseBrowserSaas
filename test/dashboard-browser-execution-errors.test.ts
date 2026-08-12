import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EXECUTION_ERROR_DEFINITIONS } from '../dashboard/src/lib/execution/errors.js';

const mocks = vi.hoisted(() => ({
  loadEngineModules: vi.fn(),
  createRun: vi.fn(),
  markRunComplete: vi.fn(),
  markRunFailed: vi.fn(),
  markRunTimedOut: vi.fn(),
  finalizeRun: vi.fn(),
  appendEvents: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  flush: vi.fn(),
  drain: vi.fn(),
  toArray: vi.fn(),
  recordOperation: vi.fn(),
  buildScreenshotCandidates: vi.fn(),
  persistScreenshotCandidates: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getLlmByName: vi.fn(),
  agentOptions: vi.fn(),
  agentRun: vi.fn(),
  agentStop: vi.fn(),
  browserClose: vi.fn(),
}));

vi.mock('../dashboard/src/lib/browser/engine-loader.js', () => ({
  EngineLoader: class {
    loadEngineModules = mocks.loadEngineModules;
  },
}));

vi.mock('../dashboard/src/lib/browser/run-persistence.js', () => ({
  PrismaRunPersistence: class {
    createRun = mocks.createRun;
    markRunComplete = mocks.markRunComplete;
    markRunFailed = mocks.markRunFailed;
    markRunTimedOut = mocks.markRunTimedOut;
    finalizeRun = mocks.finalizeRun;
    appendEvents = mocks.appendEvents;
  },
}));

vi.mock('../dashboard/src/lib/browser/event-collector.js', () => ({
  EventCollector: class {
    attach = mocks.attach;
    detach = mocks.detach;
    flush = mocks.flush;
    drain = mocks.drain;
    toArray = mocks.toArray;
    recordOperation = mocks.recordOperation;
  },
}));

vi.mock('../dashboard/src/lib/browser/artifact-persistence.js', () => ({
  buildScreenshotCandidates: mocks.buildScreenshotCandidates,
  persistScreenshotCandidates: mocks.persistScreenshotCandidates,
  deletePersistedArtifacts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

import { BrowserExecutionService } from '../dashboard/src/lib/browser/engine.js';

const input = {
  agentId: 'agent-1',
  userId: 'user-1',
  task: 'Safe test task',
  configuration: {
    model: 'groq_test-model',
    maxSteps: 2,
    timeoutMs: 10_000,
    browserSettings: {
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
    },
  },
};

class BrowserProfile {}

class BrowserSession {
  close = mocks.browserClose;
}

class Agent {
  eventbus = { on: vi.fn() };
  run = mocks.agentRun;
  stop = mocks.agentStop;

  constructor(options: unknown) {
    mocks.agentOptions(options);
  }
}

describe('BrowserExecutionService safe failure mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildScreenshotCandidates.mockReturnValue([]);
    mocks.persistScreenshotCandidates.mockResolvedValue([]);
    mocks.drain.mockReturnValue([]);
    mocks.toArray.mockReturnValue([]);
    mocks.flush.mockResolvedValue(undefined);
    mocks.createRun.mockResolvedValue(undefined);
    mocks.markRunFailed.mockResolvedValue(undefined);
    mocks.markRunTimedOut.mockResolvedValue(undefined);
    mocks.finalizeRun.mockResolvedValue(true);
    mocks.appendEvents.mockResolvedValue(undefined);
    mocks.browserClose.mockResolvedValue(undefined);
    mocks.loadEngineModules.mockResolvedValue({
      AgentClass: Agent,
      BrowserProfileClass: BrowserProfile,
      BrowserSessionClass: BrowserSession,
      getLlmByName: mocks.getLlmByName,
    });
  });

  it('leaves process signal ownership with the browser worker', async () => {
    mocks.getLlmByName.mockReturnValue({});
    mocks.agentRun.mockResolvedValue({
      urls: () => [],
      screenshots: () => [],
      screenshot_paths: () => [],
      final_result: () => 'done',
      is_successful: () => true,
    });

    await new BrowserExecutionService().execute(input);

    expect(mocks.agentOptions).toHaveBeenCalledWith(
      expect.objectContaining({ register_signal_handlers: false })
    );
  });

  it('maps a missing Groq key to EXECUTION_UNAVAILABLE', async () => {
    mocks.getLlmByName.mockImplementation(() => {
      throw new Error(
        'GROQ_API_KEY missing: gsk_providersecret at C:\\private\\provider.js'
      );
    });

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'EXECUTION_UNAVAILABLE',
      status: 503,
      publicMessage: 'Agent execution is temporarily unavailable.',
      stage: 'llm_create',
    });

    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      EXECUTION_ERROR_DEFINITIONS.EXECUTION_UNAVAILABLE.message,
      [],
      []
    );
    const logged = JSON.stringify(mocks.logger.error.mock.calls);
    expect(logged).not.toContain('gsk_providersecret');
    expect(logged).not.toContain('C:\\private');
  });

  it('maps missing compiled modules and filesystem paths to unavailable', async () => {
    mocks.loadEngineModules.mockRejectedValue(
      new Error('Cannot load C:\\private\\dist\\agent\\index.js')
    );

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'EXECUTION_UNAVAILABLE',
      publicMessage: 'Agent execution is temporarily unavailable.',
      stage: 'engine_load',
    });
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
      'C:\\private'
    );
  });

  it('maps unexpected agent failures to EXECUTION_FAILED and persists safely', async () => {
    mocks.getLlmByName.mockReturnValue({});
    mocks.agentRun.mockRejectedValue(
      new Error('Groq raw body gsk_providersecret and private model output')
    );

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      status: 500,
      publicMessage:
        'The agent run failed. Review the run details for more information.',
      stage: 'agent_run',
    });

    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      EXECUTION_ERROR_DEFINITIONS.EXECUTION_FAILED.message,
      [],
      []
    );
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
      'gsk_providersecret'
    );
  });

  it('persists a browser-start timeout with its bounded subsystem code', async () => {
    mocks.getLlmByName.mockReturnValue({});
    mocks.agentRun.mockImplementation(async () => {
      const options = mocks.agentOptions.mock.calls.at(-1)?.[0] as {
        operation_observer?: (event: {
          operation: string;
          status: string;
          duration_ms?: number;
        }) => void;
      };
      options.operation_observer?.({
        operation: 'BROWSER_START',
        status: 'TIMED_OUT',
        duration_ms: 30_000,
      });
      throw Object.assign(new Error('BROWSER_START_TIMEOUT'), {
        code: 'BROWSER_START_TIMEOUT',
      });
    });

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'BROWSER_START_TIMEOUT',
      status: 504,
      publicMessage: 'The browser did not start in time.',
    });
    expect(mocks.recordOperation).toHaveBeenCalledWith({
      operation: 'BROWSER_START',
      status: 'TIMED_OUT',
      duration_ms: 30_000,
    });
    expect(mocks.browserClose).toHaveBeenCalledOnce();
    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      EXECUTION_ERROR_DEFINITIONS.BROWSER_START_TIMEOUT.message,
      [],
      [],
      'BROWSER_START_TIMEOUT'
    );
    expect(mocks.markRunTimedOut).not.toHaveBeenCalled();
  });

  it('classifies an unsuccessful provider-rate-limit history without persisting provider details', async () => {
    mocks.getLlmByName.mockReturnValue({});
    mocks.agentRun.mockResolvedValue({
      urls: () => [],
      screenshots: () => [],
      screenshot_paths: () => [],
      final_result: () => null,
      is_successful: () => null,
      errors: () => [
        '429 rate_limit_exceeded for a provider account with private details',
      ],
      number_of_steps: () => 1,
    });

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      status: 503,
      publicMessage:
        'The AI provider is temporarily rate limited. Try again later.',
      stage: 'agent_result',
    });

    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      EXECUTION_ERROR_DEFINITIONS.PROVIDER_RATE_LIMITED.message,
      [],
      [],
      'PROVIDER_RATE_LIMITED'
    );
    expect(JSON.stringify(mocks.markRunFailed.mock.calls)).not.toContain(
      'private details'
    );
  });

  it('classifies a non-terminal history at the configured step ceiling', async () => {
    mocks.getLlmByName.mockReturnValue({});
    mocks.agentRun.mockResolvedValue({
      urls: () => ['https://example.com/'],
      screenshots: () => [],
      screenshot_paths: () => [],
      final_result: () => null,
      is_successful: () => null,
      errors: () => [],
      number_of_steps: () => input.configuration.maxSteps,
    });

    await expect(
      new BrowserExecutionService().execute(input)
    ).rejects.toMatchObject({
      code: 'EXECUTION_STEP_LIMIT_EXCEEDED',
      status: 422,
      stage: 'agent_result',
    });
    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      EXECUTION_ERROR_DEFINITIONS.EXECUTION_STEP_LIMIT_EXCEEDED.message,
      [],
      [],
      'EXECUTION_STEP_LIMIT_EXCEEDED'
    );
  });

  it('enforces the wall-clock timeout, stops resources, and persists TIMED_OUT', async () => {
    vi.useFakeTimers();
    try {
      mocks.getLlmByName.mockReturnValue({});
      let resolveLate!: (value: unknown) => void;
      mocks.agentRun.mockReturnValue(
        new Promise((resolve) => {
          resolveLate = resolve;
        })
      );

      const execution = new BrowserExecutionService().execute(input);
      const rejection = expect(execution).rejects.toMatchObject({
        code: 'EXECUTION_TIMED_OUT',
        status: 504,
        publicMessage: 'The agent run exceeded its time limit.',
      });
      await vi.advanceTimersByTimeAsync(input.configuration.timeoutMs);

      await rejection;
      expect(mocks.agentStop).toHaveBeenCalledOnce();
      expect(mocks.browserClose).toHaveBeenCalledOnce();
      expect(mocks.detach).toHaveBeenCalled();
      expect(mocks.markRunTimedOut).toHaveBeenCalledOnce();

      resolveLate({
        is_successful: () => true,
        final_result: () => 'late success',
      });
      await Promise.resolve();
      expect(mocks.finalizeRun).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
