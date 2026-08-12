import { describe, expect, it } from 'vitest';

import {
  armBrowserShutdownRejectionContainment,
  isClosedBrowserRejection,
  shouldContainBrowserShutdownRejection,
} from '../dashboard/src/lib/worker/unhandled-browser-rejection.js';

describe('browser worker late-rejection containment', () => {
  it.each([
    'page.evaluate: Target page, context or browser has been closed',
    'browser has been closed',
    'Browser closed while extracting the DOM',
  ])('recognizes a late Playwright shutdown rejection: %s', (message) => {
    expect(isClosedBrowserRejection(new Error(message))).toBe(true);
  });

  it.each([
    'Provider request failed',
    'Database connection closed',
    'Unexpected application invariant',
  ])('does not suppress an unrelated rejection: %s', (message) => {
    expect(isClosedBrowserRejection(new Error(message))).toBe(false);
  });

  it('contains the narrow rejection only during the armed cleanup window', () => {
    const now = Date.now();
    armBrowserShutdownRejectionContainment(1_000);
    const rejection = new Error(
      'page.evaluate: Target page, context or browser has been closed'
    );
    expect(shouldContainBrowserShutdownRejection(rejection, now + 999)).toBe(
      true
    );
    expect(shouldContainBrowserShutdownRejection(rejection, now + 1_001)).toBe(
      false
    );
    expect(
      shouldContainBrowserShutdownRejection(
        new Error('Unexpected application invariant'),
        now
      )
    ).toBe(false);
  });
});
