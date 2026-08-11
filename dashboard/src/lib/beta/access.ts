import type { BetaAccessStatus } from '@prisma/client';

export function betaExecutionBlocked(
  status: BetaAccessStatus | string | null | undefined
) {
  return status === 'SUSPENDED' || status === 'ENDED';
}

export function assertBetaExecutionAllowed(
  status: BetaAccessStatus | string | null | undefined
) {
  if (betaExecutionBlocked(status)) {
    const error = new Error('Beta access does not permit this operation.');
    error.name = 'BetaAccessError';
    throw error;
  }
}
