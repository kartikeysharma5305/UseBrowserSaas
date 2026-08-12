import { describe, expect, it } from 'vitest';

import {
  currentRunActivity,
  describeMeaningfulStep,
  failurePresentation,
  formatElapsed,
  meaningfulTimelineEvents,
} from '../dashboard/src/lib/observability/presentation';
import type { TimelineEvent } from '../dashboard/src/lib/observability/timeline';

function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'event',
    runId: 'run',
    sequence: 1,
    displaySequence: 1,
    type: 'SYSTEM',
    message: 'Internal event',
    timestamp: '2026-08-13T00:00:00.000Z',
    structuredData: {},
    artifacts: [],
    ...overrides,
  };
}

describe('polished Run presentation', () => {
  it('shows only meaningful completed or failed steps in the primary timeline', () => {
    const events = [
      event({ structuredData: { operation: 'MODEL_REQUEST' } }),
      event({ id: 'step', type: 'STEP_COMPLETED', message: 'Read docs' }),
    ];
    expect(meaningfulTimelineEvents(events).map((item) => item.id)).toEqual([
      'step',
    ]);
  });

  it('formats deterministic activities and step accomplishments', () => {
    expect(
      currentRunActivity([
        event({
          structuredData: {
            operation: 'MODEL_REQUEST',
            operationStatus: 'BEGIN',
          },
        }),
      ])
    ).toBe('Thinking…');
    expect(
      describeMeaningfulStep(
        event({
          type: 'STEP_COMPLETED',
          message: 'Step executed.',
          structuredData: {
            actionType: 'navigate',
            url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
          },
        })
      )
    ).toBe('Opened developer.mozilla.org/en-US/docs/Web/JavaScript.');
    expect(formatElapsed(125_000)).toBe('2 min 5 sec');
  });

  it('turns common safe persisted failures into useful user guidance', () => {
    expect(
      failurePresentation('The AI provider did not respond in time.', 'FAILED')
    ).toEqual({
      title: 'AI response timed out',
      description:
        'The AI provider did not respond within the allowed time. Try the Run again.',
    });
    expect(
      failurePresentation('Navigation blocked by domain policy.', 'FAILED')
        .title
    ).toBe('Navigation blocked for safety');
  });
});
