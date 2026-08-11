export const CANCELLATION_PUBLIC_MESSAGES = {
  RUN_NOT_FOUND: 'Run not found.',
  RUN_CANCEL_REQUESTED: 'Cancellation requested.',
  RUN_CANCELED: 'Run canceled.',
  CANCELLATION_UNAVAILABLE: 'Cancellation could not be requested. Try again.',
} as const;

export class RunCancellationError extends Error {
  constructor(readonly runId: string) {
    super('Run cancellation was requested.');
    this.name = 'RunCancellationError';
  }
}

export interface RunCancellationResult {
  runId: string;
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCESS'
    | 'FAILED'
    | 'TIMED_OUT'
    | 'CANCELED';
  cancelRequested: boolean;
  alreadyTerminal: boolean;
}

export function sanitizeCancellationReason(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}
