import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../src/agent/service.js';
import type { BaseChatModel } from '../src/llm/base.js';
import { EventCollector } from '../dashboard/src/lib/browser/event-collector.js';

const createLlm = (): BaseChatModel =>
  ({
    model: 'test-model',
    provider: 'test',
    name: 'test-model',
    model_name: 'test-model',
    ainvoke: vi.fn(),
  }) as unknown as BaseChatModel;

afterEach(() => {
  vi.useRealTimers();
});

describe('hierarchical execution operation timeouts', () => {
  it('bounds browser startup below the run deadline and emits the timed-out boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    const events: Array<Record<string, unknown>> = [];
    const agent = new Agent({
      task: 'bounded startup test',
      llm: createLlm(),
      register_signal_handlers: false,
      run_deadline_ms: Date.now() + 60_000,
      operation_observer: (event) => events.push(event),
    });
    let operationSignal: AbortSignal | null = null;

    const operation = (agent as any)._runObservedOperation(
      'BROWSER_START',
      2,
      (signal: AbortSignal) => {
        operationSignal = signal;
        return new Promise(() => undefined);
      }
    );
    const rejection = expect(operation).rejects.toMatchObject({
      code: 'BROWSER_START_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
    expect(operationSignal?.aborted).toBe(true);
    expect(events).toEqual([
      { operation: 'BROWSER_START', status: 'BEGIN' },
      {
        operation: 'BROWSER_START',
        status: 'TIMED_OUT',
        duration_ms: 2_000,
      },
    ]);
    await agent.close();
  });

  it('caps provider work to the remaining run budget and aborts the request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    const agent = new Agent({
      task: 'remaining budget test',
      llm: createLlm(),
      register_signal_handlers: false,
      run_deadline_ms: Date.now() + 750,
    });
    let operationSignal: AbortSignal | null = null;

    const operation = (agent as any)._runObservedOperation(
      'MODEL_REQUEST',
      60,
      (signal: AbortSignal) => {
        operationSignal = signal;
        return new Promise(() => undefined);
      }
    );
    const rejection = expect(operation).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      timeoutSeconds: 0.75,
    });

    await vi.advanceTimersByTimeAsync(750);
    await rejection;
    expect(operationSignal?.aborted).toBe(true);
    await agent.close();
  });

  it('persists only a safe operation phase, status, and bounded duration', () => {
    const collector = new EventCollector(3);
    collector.recordOperation({ operation: 'NAVIGATION', status: 'BEGIN' });
    collector.recordOperation({
      operation: 'NAVIGATION',
      status: 'END',
      duration_ms: 321,
    });

    expect(collector.toArray()).toEqual([
      expect.objectContaining({
        sequence: 3,
        type: 'SYSTEM',
        message: 'Navigating to target…',
        data: {
          operation: 'NAVIGATION',
          operationStatus: 'BEGIN',
        },
      }),
      expect.objectContaining({
        sequence: 4,
        type: 'SYSTEM',
        message: 'Navigating to target completed.',
        data: {
          operation: 'NAVIGATION',
          operationStatus: 'END',
          durationMs: 321,
          success: true,
        },
      }),
    ]);
  });
});
