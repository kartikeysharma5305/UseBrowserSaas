import { describe, expect, it } from 'vitest';

import { EventCollector } from '../dashboard/src/lib/browser/event-collector.js';
import {
  normalizeActionSummary,
  normalizeEventUrl,
  sanitizeEventData,
  truncateEventText,
} from '../dashboard/src/lib/observability/event-data.js';
import { buildTimeline } from '../dashboard/src/lib/observability/timeline.js';

function attachedCollector() {
  const handlers = new Map<string, (event: unknown) => void>();
  const collector = new EventCollector();
  collector.attach({
    eventbus: {
      on: (name, handler) => {
        handlers.set(name, handler);
      },
    },
  });
  return { collector, handlers };
}

describe('structured execution events', () => {
  it('subscribes only to the three proven root event classes', () => {
    const { handlers } = attachedCollector();
    expect([...handlers.keys()]).toEqual([
      'CreateAgentStepEvent',
      'CreateAgentTaskEvent',
      'UpdateAgentTaskEvent',
    ]);
  });

  it('starts collected engine events at sequence 2 after RUN_STARTED', () => {
    const { collector, handlers } = attachedCollector();
    handlers.get('CreateAgentTaskEvent')?.({ llm_model: 'groq_test' });
    expect(collector.toArray()[0]?.sequence).toBe(2);
  });

  it('keeps event ordering deterministic', () => {
    const { collector, handlers } = attachedCollector();
    handlers.get('CreateAgentTaskEvent')?.({ llm_model: 'groq_test' });
    handlers.get('CreateAgentStepEvent')?.({ step: 1, actions: [] });
    handlers.get('UpdateAgentTaskEvent')?.({ stopped: false });
    expect(collector.toArray().map((event) => event.sequence)).toEqual([
      2, 3, 4,
    ]);
  });

  it('extracts bounded action names without persisting action parameters', () => {
    expect(
      normalizeActionSummary([
        { input_text: { text: 'secret' } },
        { click_element: { index: 4 } },
      ])
    ).toEqual({
      actionType: 'input_text',
      actionSummary: 'input_text, click_element',
    });
  });

  it('sanitizes secret-like event text', () => {
    expect(
      truncateEventText('authorization=Bearer-secret gsk_abcdefghijkl')
    ).not.toContain('gsk_abcdefghijkl');
  });

  it('truncates oversized event strings', () => {
    expect(truncateEventText('x'.repeat(800), 100)).toHaveLength(100);
  });

  it('accepts only credential-free HTTP URLs', () => {
    expect(normalizeEventUrl('https://example.com/path')).toBe(
      'https://example.com/path'
    );
    expect(normalizeEventUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeEventUrl('https://user:pass@example.com')).toBeUndefined();
  });

  it('discards unknown event payload fields', () => {
    expect(
      sanitizeEventData({
        stepNumber: 3,
        cookies: ['secret'],
        html: '<html>',
        authorization: 'secret',
      })
    ).toEqual({ stepNumber: 3 });
  });

  it('does not retain task text, memory, or raw done output', () => {
    const { collector, handlers } = attachedCollector();
    handlers.get('CreateAgentTaskEvent')?.({
      task: 'private task',
      llm_model: 'groq_test',
    });
    handlers.get('CreateAgentStepEvent')?.({
      step: 1,
      memory: 'private memory',
      actions: [],
    });
    handlers.get('UpdateAgentTaskEvent')?.({
      done_output: 'raw output',
      stopped: false,
    });
    expect(JSON.stringify(collector.toArray())).not.toMatch(
      /private task|private memory|raw output/
    );
  });

  it('associates the proven step screenshot data URL with its sequence', () => {
    const { collector, handlers } = attachedCollector();
    handlers.get('CreateAgentStepEvent')?.({
      step: 2,
      screenshot_url: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(collector.toArray()[0]?.screenshot).toMatchObject({
      kind: 'data-url',
      stepNumber: 2,
      eventSequence: 2,
    });
  });

  it('supports legacy events without sequence or data', () => {
    const timeline = buildTimeline(
      [
        {
          id: 'legacy',
          runId: 'run',
          type: 'SYSTEM',
          message: 'Legacy event',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      []
    );
    expect(timeline[0]).toMatchObject({
      displaySequence: 1,
      structuredData: {},
      artifacts: [],
    });
  });

  it('links artifacts by persisted event sequence', () => {
    const timeline = buildTimeline(
      [
        {
          id: 'event',
          runId: 'run',
          sequence: 2,
          type: 'STEP_COMPLETED',
          message: 'Done',
          data: { stepNumber: 1 },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        {
          id: 'artifact',
          type: 'SCREENSHOT',
          fileName: 'safe.png',
          mimeType: 'image/png',
          size: 8,
          stepNumber: 1,
          eventSequence: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          url: '/api/runs/run/artifacts/artifact',
        },
      ]
    );
    expect(timeline[0]?.artifacts).toHaveLength(1);
  });
});
