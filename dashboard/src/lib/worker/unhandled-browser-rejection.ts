import { safeSerializeError } from '@/lib/execution/errors';
import { logger } from '@/lib/logger';

const CLOSED_BROWSER_REJECTION =
  /target (?:page|context|browser).*closed|(?:page|context|browser) has been closed|browser closed/i;
let expectedShutdownUntil = 0;

export function armBrowserShutdownRejectionContainment(graceMs = 30_000) {
  expectedShutdownUntil = Math.max(expectedShutdownUntil, Date.now() + graceMs);
}

export function isClosedBrowserRejection(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return CLOSED_BROWSER_REJECTION.test(message);
}

export function shouldContainBrowserShutdownRejection(
  reason: unknown,
  now = Date.now()
): boolean {
  return now <= expectedShutdownUntil && isClosedBrowserRejection(reason);
}

/**
 * Playwright work already in flight can reject after a bounded Run timeout has
 * intentionally closed its browser. Node treats that detached rejection as a
 * process-fatal error even though the Run has already been finalized. Suppress
 * only this narrow, expected shutdown race; preserve crash-on-bug behavior for
 * every other unhandled rejection.
 */
export function installBrowserShutdownRejectionContainment(): () => void {
  const handler = (reason: unknown) => {
    if (shouldContainBrowserShutdownRejection(reason)) {
      logger.warn('Contained late browser rejection after resource shutdown', {
        stage: 'cleanup',
        error: safeSerializeError(reason),
      });
      return;
    }

    process.off('unhandledRejection', handler);
    queueMicrotask(() => {
      throw reason;
    });
  };
  process.on('unhandledRejection', handler);
  return () => process.off('unhandledRejection', handler);
}
