import {
  normalizeActionSummary,
  normalizeEventUrl,
  sanitizeEventData,
  truncateEventText,
  type RunEventData,
} from '@/lib/observability/event-data';

interface StepEventData {
  step?: unknown;
  created_at?: unknown;
  evaluation_previous_goal?: unknown;
  actions?: unknown;
  screenshot_url?: unknown;
  url?: unknown;
}

interface TaskStartEventData {
  started_at?: unknown;
  llm_model?: unknown;
}

interface TaskUpdateEventData {
  finished_at?: unknown;
  stopped?: unknown;
  paused?: unknown;
}

export interface OperationEventData {
  operation: string;
  status: 'BEGIN' | 'END' | 'FAILED' | 'TIMED_OUT';
  duration_ms?: number;
}

const OPERATION_MESSAGES: Record<string, string> = {
  BROWSER_START: 'Launching browser',
  NAVIGATION: 'Navigating to target',
  PAGE_READY: 'Reading page content',
  MODEL_REQUEST: 'Requesting AI action',
  ACTION: 'Executing browser action',
  SCREENSHOT: 'Capturing screenshot',
};

export type CollectedEventType =
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'SYSTEM';

export interface ScreenshotCandidate {
  kind: 'data-url' | 'base64' | 'file';
  value: string;
  mimeType?: 'image/png' | 'image/jpeg';
  stepNumber: number | null;
  eventSequence: number | null;
}

export interface CollectedEvent {
  sequence: number;
  type: CollectedEventType;
  message: string;
  data: RunEventData;
  timestamp: Date;
  screenshot?: ScreenshotCandidate;
}

export type CollectedEventHandler = (
  event: CollectedEvent
) => void | Promise<void>;

function eventDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export class EventCollector {
  private readonly events: CollectedEvent[] = [];
  private unsubscribe: Array<() => void> = [];
  private nextSequence: number;
  private attached = false;
  private pendingPersistence = Promise.resolve();
  private persistenceError: unknown;

  constructor(
    private readonly initialSequence = 2,
    private readonly onEvent?: CollectedEventHandler,
    private readonly redactText: (value: string) => string = (value) => value
  ) {
    this.nextSequence = initialSequence;
  }

  attach(agent: {
    eventbus: {
      on: (
        name: string,
        handler: (event: unknown) => void
      ) => void | (() => void);
    };
  }) {
    if (this.attached) {
      throw new Error('Event collector is already attached.');
    }
    this.attached = true;

    const subscribe = (name: string, handler: (event: unknown) => void) => {
      const remove = agent.eventbus.on(name, (event: unknown) => {
        if (this.attached) handler(event);
      });
      if (typeof remove === 'function') this.unsubscribe.push(remove);
    };

    subscribe('CreateAgentStepEvent', (event) => this.handleStepEvent(event));
    subscribe('CreateAgentTaskEvent', (event) =>
      this.handleTaskStartEvent(event)
    );
    subscribe('UpdateAgentTaskEvent', (event) =>
      this.handleTaskUpdateEvent(event)
    );
  }

  detach(): void {
    if (!this.attached && this.unsubscribe.length === 0) return;
    this.attached = false;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = [];
    for (const remove of unsubscribe) {
      try {
        remove();
      } catch {
        // Detachment is best effort and remains idempotent.
      }
    }
  }

  drain(): CollectedEvent[] {
    this.detach();
    const drained = [...this.events];
    this.events.length = 0;
    this.nextSequence = this.initialSequence;
    return drained;
  }

  toArray(): CollectedEvent[] {
    return [...this.events];
  }

  async flush(): Promise<void> {
    await this.pendingPersistence;
    if (this.persistenceError) throw this.persistenceError;
  }

  recordOperation(rawEvent: OperationEventData): void {
    const operation = OPERATION_MESSAGES[rawEvent.operation]
      ? rawEvent.operation
      : 'UNKNOWN';
    const baseMessage = OPERATION_MESSAGES[operation] ?? 'Processing run';
    const status = rawEvent.status;
    const suffix =
      status === 'END'
        ? ' completed.'
        : status === 'FAILED'
          ? ' failed.'
          : status === 'TIMED_OUT'
            ? ' timed out.'
            : '…';
    const durationMs =
      typeof rawEvent.duration_ms === 'number' &&
      Number.isSafeInteger(rawEvent.duration_ms) &&
      rawEvent.duration_ms >= 0
        ? rawEvent.duration_ms
        : undefined;

    this.collect({
      sequence: this.takeSequence(),
      type: 'SYSTEM',
      message: `${baseMessage}${suffix}`,
      data: sanitizeEventData({
        operation,
        operationStatus: status,
        durationMs,
        success:
          status === 'END'
            ? true
            : status === 'FAILED' || status === 'TIMED_OUT'
              ? false
              : undefined,
      }),
      timestamp: new Date(),
    });
  }

  private collect(event: CollectedEvent): void {
    this.events.push(event);
    if (this.onEvent && !this.persistenceError) {
      this.pendingPersistence = this.pendingPersistence
        .then(() => this.onEvent?.(event))
        .catch((error) => {
          this.persistenceError = error;
        });
    }
  }

  private takeSequence(): number {
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    return sequence;
  }

  private handleStepEvent(rawEvent: unknown) {
    const stepEvent =
      typeof rawEvent === 'object' && rawEvent !== null
        ? (rawEvent as StepEventData)
        : {};
    const sequence = this.takeSequence();
    const stepNumber =
      typeof stepEvent.step === 'number' &&
      Number.isSafeInteger(stepEvent.step) &&
      stepEvent.step >= 0
        ? stepEvent.step
        : undefined;
    const action = normalizeActionSummary(stepEvent.actions);
    const data = sanitizeEventData({
      stepNumber,
      ...action,
      url: normalizeEventUrl(stepEvent.url),
    });
    const rawMessage =
      typeof stepEvent.evaluation_previous_goal === 'string'
        ? this.redactText(stepEvent.evaluation_previous_goal)
        : stepEvent.evaluation_previous_goal;
    const message = truncateEventText(rawMessage) ?? 'Step executed.';
    const screenshotUrl =
      typeof stepEvent.screenshot_url === 'string'
        ? stepEvent.screenshot_url
        : undefined;

    this.collect({
      sequence,
      type: 'STEP_COMPLETED',
      message,
      data,
      timestamp: eventDate(stepEvent.created_at),
      ...(screenshotUrl?.startsWith('data:image/')
        ? {
            screenshot: {
              kind: 'data-url' as const,
              value: screenshotUrl,
              stepNumber: stepNumber ?? null,
              eventSequence: sequence,
            },
          }
        : {}),
    });
  }

  private handleTaskStartEvent(rawEvent: unknown) {
    const taskEvent =
      typeof rawEvent === 'object' && rawEvent !== null
        ? (rawEvent as TaskStartEventData)
        : {};

    this.collect({
      sequence: this.takeSequence(),
      type: 'STEP_STARTED',
      message: 'Agent task started.',
      data: sanitizeEventData({ model: taskEvent.llm_model }),
      timestamp: eventDate(taskEvent.started_at),
    });
  }

  private handleTaskUpdateEvent(rawEvent: unknown) {
    const updateEvent =
      typeof rawEvent === 'object' && rawEvent !== null
        ? (rawEvent as TaskUpdateEventData)
        : {};
    const stopped =
      typeof updateEvent.stopped === 'boolean'
        ? updateEvent.stopped
        : undefined;

    this.collect({
      sequence: this.takeSequence(),
      type: stopped ? 'STEP_FAILED' : 'SYSTEM',
      message: stopped ? 'Agent task stopped.' : 'Agent task updated.',
      data: sanitizeEventData({
        stopped,
        paused: updateEvent.paused,
        success: stopped === true ? false : undefined,
      }),
      timestamp: eventDate(updateEvent.finished_at),
    });
  }
}
