import { describe, expect, it, vi } from 'vitest';

import {
  createRunWebhookEvent,
  createScheduleWebhookEvent,
  createWebhookEventRecord,
} from '@/lib/webhooks/events';

function transaction(
  options: { inserted?: number; endpoints?: string[] } = {}
) {
  const tx: any = {
    webhookEvent: {
      createMany: vi.fn().mockResolvedValue({ count: options.inserted ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'evt_1' }),
    },
    webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    webhookEndpoint: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          (options.endpoints ?? ['endpoint-1']).map((id) => ({ id }))
        ),
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ planCode: 'PRO', accountDeletion: null }),
    },
    run: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'run-1', agentId: 'agent-1' }),
    },
  };
  return tx;
}

describe('Phase 14 durable logical events', () => {
  it('creates one safe Run event and subscribed deliveries', async () => {
    const tx = transaction();
    await createRunWebhookEvent(tx, {
      userId: 'user-1',
      runId: 'run-1',
      status: 'SUCCESS',
    });
    const row = tx.webhookEvent.createMany.mock.calls[0][0].data[0];
    expect(row.type).toBe('run.succeeded');
    expect(row.idempotencyKey).toBe('run:run-1:webhook:run.succeeded');
    expect(row.payload.data).toEqual({
      runId: 'run-1',
      agentId: 'agent-1',
      status: 'SUCCESS',
    });
    expect(JSON.stringify(row.payload)).not.toMatch(
      /task|variable|result|worker|queue|provider|storage/i
    );
    expect(tx.webhookDelivery.createMany).toHaveBeenCalledOnce();
  });

  it('does not create deliveries for a duplicate logical transition', async () => {
    const tx = transaction({ inserted: 0 });
    const result = await createWebhookEventRecord(tx, {
      userId: 'user-1',
      type: 'run.failed',
      idempotencyKey: 'same',
      data: { status: 'FAILED' },
    });
    expect(result).toEqual({ eventId: 'evt_1', created: false, deliveries: 0 });
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMITTED', 'schedule.triggered'],
    ['QUOTA_BLOCKED', 'schedule.blocked'],
    ['PLAN_BLOCKED', 'schedule.blocked'],
    ['FAILED', 'schedule.failed'],
  ] as const)('maps occurrence %s to %s once', async (status, type) => {
    const tx = transaction();
    await createScheduleWebhookEvent(tx, {
      userId: 'user-1',
      scheduleId: 'schedule-1',
      occurrenceId: 'occurrence-1',
      status,
    });
    expect(tx.webhookEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
      type,
      idempotencyKey: `schedule-occurrence:occurrence-1:webhook:${type}`,
    });
  });

  it('retains the same event identity for replay by creating delivery sequences', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile('dashboard/src/lib/webhooks/service.ts', 'utf8')
    );
    expect(source).toContain('eventId: original.eventId');
    expect(source).toContain('sequence: (maximum._max.sequence ?? 0) + 1');
  });
});
