import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('@/lib/notifications/queue', () => ({
  enqueueNotificationDelivery: mocks.enqueue,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { renderNotificationEmail } from '@/lib/notifications/templates';
import {
  createNotificationRecord,
  NOTIFICATION_PREFERENCE_DEFAULTS,
} from '@/lib/notifications/service';
import { getEmailConfiguration } from '@/lib/notifications/config';
import { notificationPreferenceSchema } from '@/lib/notifications/schemas';

describe('Phase 7 notification persistence and templates', () => {
  beforeEach(() => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.APP_BASE_URL;
    process.env.EMAIL_ENABLED = 'false';
    process.env.EMAIL_PROVIDER = 'development';
  });

  it('starts disabled without provider credentials', () => {
    expect(getEmailConfiguration()).toMatchObject({
      enabled: false,
      apiKey: null,
    });
  });

  it('requires server-controlled configuration only when enabled', () => {
    process.env.EMAIL_ENABLED = 'true';
    expect(() => getEmailConfiguration()).toThrow('EMAIL_FROM');
    process.env.EMAIL_FROM = 'notify@example.test';
    process.env.APP_BASE_URL = 'javascript:alert(1)';
    expect(() => getEmailConfiguration()).toThrow('HTTP or HTTPS');
  });

  it('uses conservative preference defaults', () => {
    expect(NOTIFICATION_PREFERENCE_DEFAULTS).toMatchObject({
      runSuccess: false,
      runFailure: true,
      runCanceled: false,
      scheduledAlerts: true,
      billingAlerts: true,
      usageAlerts: true,
      dailyDigest: false,
    });
  });

  it('validates strict preferences and IANA timezones', () => {
    expect(
      notificationPreferenceSchema.safeParse({ timezone: 'Asia/Kolkata' })
        .success
    ).toBe(true);
    expect(
      notificationPreferenceSchema.safeParse({ timezone: 'not/a-zone' }).success
    ).toBe(false);
    expect(
      notificationPreferenceSchema.safeParse({
        recipientEmail: 'attacker@example.test',
      }).success
    ).toBe(false);
  });

  it('escapes names and ignores unsafe action URLs and unrecognized payload content', () => {
    const rendered = renderNotificationEmail({
      type: 'RUN_FAILED',
      appBaseUrl: 'https://dashboard.example.test',
      payload: {
        agentName: '<img src=x onerror=alert(1)>',
        actionPath: '//evil.example/phish',
        task: 'SECRET TASK',
        providerError: 'stack trace',
      },
    });
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).not.toContain('onerror=alert(1)>');
    expect(rendered.text).toContain(
      'https://dashboard.example.test/dashboard/notifications'
    );
    expect(JSON.stringify(rendered)).not.toContain('SECRET TASK');
    expect(JSON.stringify(rendered)).not.toContain('stack trace');
    expect(rendered.text.length).toBeGreaterThan(0);
  });

  it('persists one event and suppresses delivery under default run-success preference', async () => {
    const transaction = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            email: 'owner@example.test',
            notificationPreference: null,
          }),
      },
      notification: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      notificationDelivery: {
        create: vi
          .fn()
          .mockResolvedValue({ id: 'delivery-1', status: 'SUPPRESSED' }),
      },
    };
    const result = await createNotificationRecord(transaction as never, {
      userId: 'user-1',
      type: 'RUN_SUCCEEDED',
      idempotencyKey: 'run:1:terminal:SUCCESS',
      payload: { task: 'bounded but never rendered' },
    });
    expect(result).toMatchObject({ created: true, deliveryId: null });
    expect(transaction.notificationDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUPPRESSED',
          failureCode: 'PREFERENCE_DISABLED',
        }),
      })
    );
  });

  it('does not create another delivery for an existing idempotency key', async () => {
    const transaction = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            email: 'owner@example.test',
            notificationPreference: null,
          }),
      },
      notification: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      notificationDelivery: { create: vi.fn() },
    };
    expect(
      await createNotificationRecord(transaction as never, {
        userId: 'user-1',
        type: 'RUN_FAILED',
        idempotencyKey: 'run:1:terminal:FAILED',
      })
    ).toEqual({
      notificationId: 'notification-1',
      created: false,
      deliveryId: null,
    });
    expect(transaction.notificationDelivery.create).not.toHaveBeenCalled();
  });
});
