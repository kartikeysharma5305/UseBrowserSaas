import type { RunStatus } from '@prisma/client';

export const ACTIVE_RUN_STATUSES = ['QUEUED', 'RUNNING'] as const;
export const TERMINAL_RUN_STATUSES = [
  'SUCCESS',
  'FAILED',
  'TIMED_OUT',
  'CANCELED',
] as const;

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  QUEUED: ['RUNNING', 'FAILED', 'TIMED_OUT', 'CANCELED'],
  RUNNING: ['QUEUED', 'SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'],
  SUCCESS: [],
  FAILED: [],
  TIMED_OUT: [],
  CANCELED: [],
};

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

export function canTransitionRunStatus(
  current: RunStatus,
  next: RunStatus
): boolean {
  return current === next || allowedTransitions[current].includes(next);
}

export class InvalidRunTransitionError extends Error {
  constructor(
    readonly current: RunStatus,
    readonly next: RunStatus
  ) {
    super(`Run cannot transition from ${current} to ${next}.`);
    this.name = 'InvalidRunTransitionError';
  }
}

export function assertRunStatusTransition(
  current: RunStatus,
  next: RunStatus
): void {
  if (!canTransitionRunStatus(current, next)) {
    throw new InvalidRunTransitionError(current, next);
  }
}
