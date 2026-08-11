import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  classifyWebhookResponse,
  performWebhookRequest,
} from '@/lib/webhooks/delivery-processor';
import {
  webhookDeliveryJob,
  webhookDeliveryJobSchema,
} from '@/lib/webhooks/job';

describe('Phase 14 bounded delivery and queue contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [200, false, true, false],
    [204, false, true, false],
    [400, false, false, false],
    [408, false, false, true],
    [429, false, false, true],
    [500, false, false, true],
    [302, false, false, false],
    [200, true, false, false],
  ])(
    'classifies status %s oversized=%s',
    (status, oversized, success, retry) => {
      expect(
        classifyWebhookResponse(status as number, oversized as boolean)
      ).toMatchObject({ success, retry });
    }
  );

  it('sends exact bytes with signed headers, no redirect, cookies, or ambient auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await performWebhookRequest({
      url: 'https://example.com/hook',
      eventId: 'evt_1',
      timestamp: 123,
      signature: 'v1=abc',
      body: '{"safe":true}',
      timeoutMs: 1_000,
      responseLimit: 1_024,
    });
    expect(result.status).toBe(202);
    const options = fetchMock.mock.calls[0][1];
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      body: '{"safe":true}',
    });
    expect(options.headers).toMatchObject({
      'webhook-id': 'evt_1',
      'webhook-timestamp': '123',
      'webhook-signature': 'v1=abc',
    });
    expect(JSON.stringify(options.headers)).not.toMatch(
      /authorization|cookie|api.?key/i
    );
  });

  it('bounds and discards response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(20), { status: 200 }))
    );
    await expect(
      performWebhookRequest({
        url: 'https://example.com/hook',
        eventId: 'evt_1',
        timestamp: 1,
        signature: 'v1=x',
        body: '{}',
        timeoutMs: 1_000,
        responseLimit: 8,
      })
    ).resolves.toMatchObject({ oversized: true });
  });

  it('uses a minimal validated job and deterministic delivery job id', async () => {
    expect(webhookDeliveryJob('delivery-1')).toEqual({
      version: 1,
      deliveryId: 'delivery-1',
    });
    expect(
      webhookDeliveryJobSchema.safeParse({
        version: 1,
        deliveryId: 'd',
        secret: 'no',
      }).success
    ).toBe(false);
    const queue = await readFile('dashboard/src/lib/webhooks/queue.ts', 'utf8');
    expect(queue).toContain('jobId: deliveryId');
    expect(queue).toContain("'deliver-outbound-webhook'");
  });

  it('implements leases, bounded retries, auto-disable, and reconciliation', async () => {
    const processor = await readFile(
      'dashboard/src/lib/webhooks/delivery-processor.ts',
      'utf8'
    );
    const worker = await readFile(
      'dashboard/src/worker/webhook-worker.ts',
      'utf8'
    );
    expect(processor).toContain('processingLeaseUntil');
    expect(processor).toContain('disableThreshold');
    expect(processor).toContain("status: 'DISABLED'");
    expect(processor).toContain('attemptCount >= config.attempts');
    expect(worker).toContain('enqueuePendingWebhookDeliveries');
    expect(worker).toContain('clearInterval(reconciliation)');
  });

  it('integrates authoritative Run, schedule, and deletion transitions', async () => {
    const ledger = await readFile('dashboard/src/lib/usage/ledger.ts', 'utf8');
    const lease = await readFile(
      'dashboard/src/lib/worker/run-lease.ts',
      'utf8'
    );
    const schedule = await readFile(
      'dashboard/src/lib/scheduling/processor.ts',
      'utf8'
    );
    const deletion = await readFile(
      'dashboard/src/lib/account-deletion.ts',
      'utf8'
    );
    expect(ledger).toContain('createRunWebhookEvent');
    expect(lease).toContain('RunStatus.RUNNING');
    expect(schedule).toContain('createScheduleWebhookEvent');
    expect(deletion).toContain("failureCode: 'ACCOUNT_DELETION'");
    expect(deletion).toContain('webhookEndpoint.deleteMany');
  });
});
