import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ChatNvidia, NVIDIA_NIM_BASE_URL } from '../src/llm/nvidia/chat.js';
import { getLlmByName } from '../src/llm/models.js';
import { ModelRateLimitError } from '../src/llm/exceptions.js';
import { SystemMessage, UserMessage } from '../src/llm/messages.js';
import {
  assertExecutionModelAvailable,
  getAvailableExecutionModels,
  getSupportedExecutionModel,
} from '../dashboard/src/lib/execution/model-catalogue.js';
import { normalizeAgentConfiguration } from '../dashboard/src/lib/execution/agent-configuration.js';
import { providerFailureCode } from '../dashboard/src/lib/browser/engine.js';
import { redactLogValue } from '../dashboard/src/lib/logger.js';
import { toRunApiRecord } from '../dashboard/src/lib/api/run-record.js';
import {
  getCounterSamples,
  resetOperationsMetricsForTests,
} from '../dashboard/src/lib/operations/metrics.js';
import { recordProviderRunOutcome } from '../dashboard/src/lib/operations/signals.js';
import { isRetryableExecutionFailure } from '../dashboard/src/lib/worker/browser-run-processor.js';
import { ExecutionServiceError } from '../dashboard/src/lib/execution/errors.js';

const originalEnvironment = {
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM_ALLOWED_MODELS: process.env.NVIDIA_NIM_ALLOWED_MODELS,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetOperationsMetricsForTests();
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Phase 27C NVIDIA NIM provider', () => {
  it('resolves only bounded NVIDIA aliases through the fixed provider adapter', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test-only';
    const model = getLlmByName('nvidia_glm-5.2') as ChatNvidia;
    expect(model.provider).toBe('nvidia');
    expect(model.model).toBe('z-ai/glm-5.2');
    expect(() => getLlmByName('nvidia_arbitrary/model')).toThrow(
      'not approved'
    );
  });

  it('gates candidates on explicit approval and provider configuration', () => {
    const id = 'nvidia_glm-5.2';
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_NIM_ALLOWED_MODELS;
    expect(getSupportedExecutionModel(id)).toBeNull();

    process.env.NVIDIA_NIM_ALLOWED_MODELS = id;
    expect(getSupportedExecutionModel(id)?.provider).toBe('nvidia');
    expect(() => assertExecutionModelAvailable(id)).toThrow('unavailable');

    process.env.NVIDIA_API_KEY = 'nvapi-test-only';
    expect(getAvailableExecutionModels().map((model) => model.id)).toContain(
      id
    );
    expect(assertExecutionModelAvailable(id).providerModel).toBe(
      'z-ai/glm-5.2'
    );
  });

  it('normalizes provider and provider model into the immutable configuration', () => {
    const configuration = normalizeAgentConfiguration({
      model: 'nvidia_glm-5.2',
    });
    expect(configuration).toMatchObject({
      model: 'nvidia_glm-5.2',
      provider: 'nvidia',
      providerModel: 'z-ai/glm-5.2',
    });
  });

  it('uses the fixed NIM endpoint and normalizes usage and prompted JSON', async () => {
    let request: Request | null = null;
    const fetchImplementation: typeof fetch = vi.fn(async (input, init) => {
      request = new Request(input, init);
      return new Response(
        JSON.stringify({
          id: 'safe-id',
          object: 'chat.completion',
          created: 1,
          model: 'z-ai/glm-5.2',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"action":"done"}' },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const model = new ChatNvidia({
      model: 'z-ai/glm-5.2',
      apiKey: 'nvapi-test-only',
      fetchImplementation,
      maxRetries: 0,
    });
    const schema = z.object({ action: z.literal('done') });
    const completion = await model.ainvoke(
      [new SystemMessage('Choose one action.'), new UserMessage('Finish.')],
      schema
    );
    expect(completion.completion).toEqual({ action: 'done' });
    expect(completion.usage).toMatchObject({
      prompt_tokens: 7,
      completion_tokens: 4,
      total_tokens: 11,
    });
    expect(request).not.toBeNull();
    expect(new URL((request as unknown as Request).url).origin).toBe(
      new URL(NVIDIA_NIM_BASE_URL).origin
    );
    expect((request as unknown as Request).headers.get('authorization')).toBe(
      'Bearer nvapi-test-only'
    );
    const requestBody = JSON.parse(
      await (request as unknown as Request).clone().text()
    );
    expect(requestBody).toMatchObject({
      model: 'z-ai/glm-5.2',
      max_tokens: 4096,
    });
    expect(requestBody).not.toHaveProperty('max_completion_tokens');
  });

  it('disables detailed thinking for Nemotron tool/action output', async () => {
    let body: Record<string, unknown> | null = null;
    const model = new ChatNvidia({
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      apiKey: 'nvapi-test-only',
      maxRetries: 0,
      fetchImplementation: vi.fn(async (input, init) => {
        body = JSON.parse(await new Request(input, init).text());
        return new Response(
          JSON.stringify({
            id: 'safe-id',
            object: 'chat.completion',
            created: 1,
            model: 'nvidia/nemotron-3-ultra-550b-a55b',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'OK' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });
    await model.ainvoke([new UserMessage('test')]);
    expect(body).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('classifies bounded provider failures and preserves rate-limit fail-fast', async () => {
    const model = new ChatNvidia({
      model: 'z-ai/glm-5.2',
      apiKey: 'nvapi-test-only',
      maxRetries: 0,
      fetchImplementation: vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'limited' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
      ),
    });
    await expect(
      model.ainvoke([new UserMessage('test')])
    ).rejects.toBeInstanceOf(ModelRateLimitError);
    expect(providerFailureCode({ statusCode: 401, message: 'private' })).toBe(
      'PROVIDER_AUTH_FAILED'
    );
    expect(providerFailureCode({ statusCode: 404, message: 'private' })).toBe(
      'PROVIDER_MODEL_UNAVAILABLE'
    );
    expect(providerFailureCode(new Error('request timed out'))).toBe(
      'PROVIDER_TIMEOUT'
    );
    expect(providerFailureCode(new Error('malformed JSON response'))).toBe(
      'PROVIDER_BAD_RESPONSE'
    );
  });

  it('propagates AbortSignal to the NVIDIA HTTP request', async () => {
    let requestSignal: AbortSignal | null = null;
    const model = new ChatNvidia({
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      apiKey: 'nvapi-test-only',
      maxRetries: 0,
      fetchImplementation: vi.fn(async (input, init) => {
        const request = new Request(input, init);
        requestSignal = request.signal;
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }),
    });
    const controller = new AbortController();
    const invocation = model.ainvoke([new UserMessage('test')], undefined, {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(requestSignal).not.toBeNull());
    controller.abort();
    await expect(invocation).rejects.toMatchObject({ name: 'ModelProviderError' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('bounds a stalled NVIDIA HTTP request with the provider timeout', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const model = new ChatNvidia({
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      apiKey: 'nvapi-test-only',
      timeout: 1_000,
      maxRetries: 0,
      fetchImplementation: vi.fn(async (input, init) => {
        const request = new Request(input, init);
        requestSignal = request.signal;
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }),
    });

    const invocation = model.ainvoke([new UserMessage('test')]);
    const rejection = expect(invocation).rejects.toMatchObject({
      name: 'ModelProviderError',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('redacts NVIDIA credentials and serves model data from the Run snapshot', () => {
    expect(
      JSON.stringify(redactLogValue('key nvapi-super-secret-value'))
    ).not.toContain('super-secret');
    const record = toRunApiRecord({
      id: 'run-1',
      agentId: 'agent-1',
      status: 'QUEUED',
      startedAt: new Date(0),
      completedAt: null,
      duration: null,
      result: null,
      errorMessage: null,
      queuedAt: new Date(0),
      attempt: 1,
      cancelRequestedAt: null,
      canceledAt: null,
      cancelReason: null,
      createdAt: new Date(0),
      executionConfiguration: {
        model: 'nvidia_glm-5.2',
        provider: 'nvidia',
      },
      inputSnapshot: null,
      outputSchemaSnapshot: null,
      outputSchemaVersion: null,
      structuredStatus: 'NOT_REQUESTED',
      structuredResult: null,
      structuredErrors: null,
      structuredValidatedAt: null,
      agent: {
        id: 'agent-1',
        userId: 'user-1',
        name: 'Agent',
        description: null,
        goal: 'goal',
        targetWebsite: 'https://example.com',
        status: 'ACTIVE',
        scheduleType: 'MANUAL',
        scheduleConfig: {},
        configuration: { model: 'groq_llama-3.3-70b-versatile' },
        safetyPolicy: {},
        outputSchema: null,
        variableVersion: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      events: [],
      artifacts: [],
    } as any);
    expect(record).toMatchObject({
      model: 'nvidia_glm-5.2',
      provider: 'nvidia',
    });
  });

  it('records only bounded provider observability labels', () => {
    recordProviderRunOutcome('nvidia', 'PROVIDER_RATE_LIMITED');
    expect(getCounterSamples()).toEqual([
      {
        name: 'provider_run_outcomes_total',
        labels: { provider: 'nvidia', provider_outcome: 'rate_limited' },
        value: 1,
      },
    ]);
  });

  it('keeps transient NVIDIA failures retryable without retrying auth failures', () => {
    expect(
      isRetryableExecutionFailure(new ExecutionServiceError('PROVIDER_TIMEOUT'))
    ).toBe(true);
    expect(
      isRetryableExecutionFailure(
        new ExecutionServiceError('PROVIDER_UNAVAILABLE')
      )
    ).toBe(true);
    expect(
      isRetryableExecutionFailure(
        new ExecutionServiceError('PROVIDER_AUTH_FAILED')
      )
    ).toBe(false);
  });
});
