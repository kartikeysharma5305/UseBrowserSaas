import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browserRunJob,
  browserRunJobSchema,
} from '../dashboard/src/lib/queue/browser-run-job.js';
import {
  getQueueConfiguration,
  getRunJobOptions,
} from '../dashboard/src/lib/queue/config.js';
import {
  canTransitionRunStatus,
  isTerminalRunStatus,
} from '../dashboard/src/lib/execution/run-state.js';
import {
  ExecutionAbortedError,
  withWallClockTimeout,
} from '../dashboard/src/lib/execution/timeout.js';
import { EventCollector } from '../dashboard/src/lib/browser/event-collector.js';
import { normalizeAgentConfiguration } from '../dashboard/src/lib/execution/agent-configuration.js';
import {
  DEFAULT_GROQ_MODEL,
  getSupportedGroqModel,
  SUPPORTED_GROQ_MODELS,
} from '../dashboard/src/lib/execution/groq-models.js';
import { createAgentSchema } from '../dashboard/src/lib/api/schemas.js';
import { EngineLoader } from '../dashboard/src/lib/browser/engine-loader.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('Phase 4 queue payload security', () => {
  it('contains only a version and opaque run ID', () => {
    expect(browserRunJob('run-1')).toEqual({ version: 1, runId: 'run-1' });
  });

  it.each([
    { version: 1, runId: '' },
    { version: 2, runId: 'run-1' },
    { version: 1, runId: 'run-1', userId: 'untrusted' },
    { version: 1, runId: 'run-1', apiKey: 'secret' },
  ])('rejects malformed or expanded payloads', (payload) => {
    expect(browserRunJobSchema.safeParse(payload).success).toBe(false);
  });
});

describe('Phase 4 queue configuration', () => {
  it('requires a server-side Redis URL', () => {
    delete process.env.REDIS_URL;
    expect(() => getQueueConfiguration()).toThrow('REDIS_URL is required');
  });

  it('rejects non-Redis protocols and malformed database indexes', () => {
    process.env.REDIS_URL = 'https://localhost:6379';
    expect(() => getQueueConfiguration()).toThrow('redis:// or rediss://');
    process.env.REDIS_URL = 'redis://localhost:6379/not-a-number';
    expect(() => getQueueConfiguration()).toThrow('database index');
  });

  it('normalizes Redis connection details without exposing the URL', () => {
    process.env.REDIS_URL = 'rediss://worker:password@redis.example:6380/2';
    const configuration = getQueueConfiguration();
    expect(configuration.connection).toMatchObject({
      host: 'redis.example',
      port: 6380,
      username: 'worker',
      password: 'password',
      db: 2,
      tls: {},
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(configuration.workerConnection).toMatchObject({
      host: 'redis.example',
      maxRetriesPerRequest: null,
    });
    expect(configuration).not.toHaveProperty('redisUrl');
  });

  it('enforces heartbeat shorter than lease', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.EXECUTION_QUEUE_HEARTBEAT_MS = '5000';
    process.env.EXECUTION_QUEUE_LEASE_MS = '5000';
    expect(() => getQueueConfiguration()).toThrow('must be less');
  });

  it('bounds concurrency, attempts, backoff, and queue depth', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.EXECUTION_QUEUE_CONCURRENCY = '0';
    expect(() => getQueueConfiguration()).toThrow();
    process.env.EXECUTION_QUEUE_CONCURRENCY = '1';
    process.env.EXECUTION_QUEUE_ATTEMPTS = '11';
    expect(() => getQueueConfiguration()).toThrow();
    process.env.EXECUTION_QUEUE_ATTEMPTS = '3';
    process.env.EXECUTION_QUEUE_MAX_WAITING = '10001';
    expect(() => getQueueConfiguration()).toThrow();
  });

  it('uses bounded retries and exponential backoff', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const configuration = getQueueConfiguration();
    expect(getRunJobOptions(configuration)).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  });
});

describe('Phase 4 run and worker lifecycle', () => {
  it('refuses worker readiness with a clear error when root dist is absent', () => {
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      expect(() =>
        new EngineLoader().resolveRepoDist('agent/index.js')
      ).toThrow('Cannot find Browser-Use engine at dist/agent/index.js.');
    } finally {
      exists.mockRestore();
    }
  });

  it('uses a verified default from the centralized Groq allowlist', () => {
    expect(SUPPORTED_GROQ_MODELS).toContain(DEFAULT_GROQ_MODEL);
    expect(getSupportedGroqModel(DEFAULT_GROQ_MODEL.id)).toBe(
      DEFAULT_GROQ_MODEL
    );
  });

  it('accepts the supported model and derives its text-only mode', () => {
    const configuration = normalizeAgentConfiguration({
      model: DEFAULT_GROQ_MODEL.id,
      timeoutMs: 60_000,
      browserSettings: { useVision: true },
    });
    expect(configuration.model).toBe(DEFAULT_GROQ_MODEL.id);
    expect(configuration.browserSettings.useVision).toBe(false);
  });

  it('rejects stale stored and API-submitted models', () => {
    const staleModel = 'groq_meta-llama/llama-4-maverick-17b-128e-instruct';
    expect(() => normalizeAgentConfiguration({ model: staleModel })).toThrow(
      'unavailable'
    );
    expect(
      createAgentSchema.safeParse({
        name: 'Test agent',
        goal: 'Read a title',
        targetWebsite: 'https://example.com',
        configuration: {
          model: staleModel,
          maxSteps: 5,
          timeoutMs: 60_000,
          browserSettings: {
            headless: true,
            viewportWidth: 1280,
            viewportHeight: 720,
          },
        },
      }).success
    ).toBe(false);
  });

  it('keeps form options backed by the same exported allowlist', () => {
    expect(SUPPORTED_GROQ_MODELS.map((model) => model.id)).toEqual([
      DEFAULT_GROQ_MODEL.id,
    ]);
  });

  it('allows a worker retry transition but never revives terminal runs', () => {
    expect(canTransitionRunStatus('RUNNING', 'QUEUED')).toBe(true);
    for (const status of [
      'SUCCESS',
      'FAILED',
      'TIMED_OUT',
      'CANCELED',
    ] as const) {
      expect(isTerminalRunStatus(status)).toBe(true);
      expect(canTransitionRunStatus(status, 'QUEUED')).toBe(false);
    }
  });

  it('starts collected events after durable queue and worker events', () => {
    const collector = new EventCollector(7);
    const handlers = new Map<string, (event: unknown) => void>();
    collector.attach({
      eventbus: {
        on(name, handler) {
          handlers.set(name, handler);
        },
      },
    });
    handlers.get('CreateAgentTaskEvent')?.({});
    expect(collector.toArray()[0]?.sequence).toBe(7);
  });

  it('aborts an in-flight operation when the worker loses its lease', async () => {
    const controller = new AbortController();
    const pending = withWallClockTimeout(
      () => new Promise<never>(() => undefined),
      60_000,
      () => undefined,
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ExecutionAbortedError);
  });
});
