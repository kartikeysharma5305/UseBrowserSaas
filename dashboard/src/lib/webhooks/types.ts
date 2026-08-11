export const WEBHOOK_EVENT_TYPES = [
  'run.queued',
  'run.started',
  'run.succeeded',
  'run.failed',
  'run.timed_out',
  'run.canceled',
  'schedule.triggered',
  'schedule.blocked',
  'schedule.failed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookLogicalEventType = WebhookEventType | 'endpoint.test';

export const RUN_WEBHOOK_EVENT = {
  QUEUED: 'run.queued',
  RUNNING: 'run.started',
  SUCCESS: 'run.succeeded',
  FAILED: 'run.failed',
  TIMED_OUT: 'run.timed_out',
  CANCELED: 'run.canceled',
} as const;
