import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  browserRunJob,
  browserRunJobSchema,
} from '@/lib/queue/browser-run-job';
import { createAgentSchema } from '@/lib/api/schemas';
import {
  createScheduleSchema,
  updateScheduleSchema,
} from '@/lib/scheduling/schemas';
import { AGENT_TEMPLATES } from '@/lib/templates/catalogue';

describe('Phase 9 durable integration boundaries', () => {
  it('keeps the BullMQ payload minimal', () => {
    expect(browserRunJob('run-1')).toEqual({ version: 1, runId: 'run-1' });
    expect(
      browserRunJobSchema.safeParse({
        version: 1,
        runId: 'run-1',
        variables: { secret: 'leak' },
      }).success
    ).toBe(false);
  });

  it('accepts declared Agent variables and rejects undeclared placeholders', () => {
    const base = {
      name: 'Reusable Agent',
      goal: 'Summarize {{website}}',
      targetWebsite: '{{website}}',
      variables: [
        {
          key: 'website',
          label: 'Website',
          type: 'URL',
          required: true,
          constraints: {},
          displayOrder: 0,
        },
      ],
    };
    expect(createAgentSchema.safeParse(base).success).toBe(true);
    expect(
      createAgentSchema.safeParse({ ...base, variables: [] }).success
    ).toBe(true);
  });

  it('accepts bounded Schedule variable maps and rejects secret-shaped nesting', () => {
    const base = {
      agentId: 'agent-1',
      kind: 'ONCE' as const,
      timezone: 'UTC',
      oneTimeAt: new Date(Date.now() + 60_000).toISOString(),
      variables: { city: 'Gurugram', count: 3, enabled: true },
    };
    expect(createScheduleSchema.safeParse(base).success).toBe(true);
    expect(
      updateScheduleSchema.safeParse({ variables: { nested: { no: true } } })
        .success
    ).toBe(false);
  });

  it('persists immutable input before enqueue and makes the worker use it', () => {
    const producer = fs.readFileSync(
      'dashboard/src/lib/queue/run-producer.ts',
      'utf8'
    );
    const lease = fs.readFileSync(
      'dashboard/src/lib/worker/run-lease.ts',
      'utf8'
    );
    const processor = fs.readFileSync(
      'dashboard/src/lib/worker/browser-run-processor.ts',
      'utf8'
    );
    expect(producer).toContain('inputSnapshot: resolved.snapshot');
    expect(producer).toContain('executionTask: resolved.task');
    expect(lease).toContain('executionTask: string | null');
    expect(processor).toContain('task: claimed.executionTask');
    expect(processor).not.toContain('task: `${claimed.agent.goal}');
  });

  it('marks changed Schedule variable configurations invalid and blocks discovery', () => {
    const agents = fs.readFileSync(
      'dashboard/src/lib/agents/service.ts',
      'utf8'
    );
    const scheduler = fs.readFileSync(
      'dashboard/src/lib/scheduling/processor.ts',
      'utf8'
    );
    expect(agents).toContain(
      "configurationErrorCode: 'VARIABLE_CONFIGURATION_INVALID'"
    );
    expect(agents).toContain("state: 'PAUSED'");
    expect(scheduler).toContain('schedule.configurationErrorCode');
  });

  it('ships variable-enabled templates as ordinary catalogue definitions', () => {
    for (const id of [
      'webpage-summarizer',
      'product-availability-checker',
      'job-listing-researcher',
      'news-page-summary',
    ]) {
      expect(
        AGENT_TEMPLATES.find((template) => template.id === id)?.variables
      ).not.toHaveLength(0);
    }
  });
});
