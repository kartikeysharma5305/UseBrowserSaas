import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  list: vi.fn(),
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/lib/api/route-helpers', () => ({
  requireAuthenticatedUser: mocks.requireUser,
  jsonError: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  handleValidationError: () =>
    Response.json({ error: 'Validation failed.' }, { status: 400 }),
  parseValidatedBody: async (request: Request, schema: any) => {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          response: Response.json(
            { error: 'Validation failed.' },
            { status: 400 }
          ),
        };
  },
}));
vi.mock('@/lib/notifications/service', () => ({
  listNotifications: mocks.list,
  getNotificationPreferences: mocks.preferences,
  updateNotificationPreferences: mocks.updatePreferences,
  markNotificationRead: mocks.read,
  markAllNotificationsRead: vi.fn().mockResolvedValue({ count: 1 }),
}));

import { GET as listNotifications } from '@/app/api/notifications/route';
import {
  GET as getPreferences,
  PATCH as patchPreferences,
} from '@/app/api/notifications/preferences/route';
import { POST as markRead } from '@/app/api/notifications/[id]/read/route';

describe('Phase 7 owner-scoped API', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects unauthenticated history and preferences', async () => {
    mocks.requireUser.mockResolvedValue(null);
    expect(
      (
        await listNotifications(
          new Request('http://localhost/api/notifications') as never
        )
      ).status
    ).toBe(401);
    expect((await getPreferences()).status).toBe(401);
  });

  it('derives list ownership from the session and bounds pagination', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    mocks.list.mockResolvedValue([]);
    expect(
      (
        await listNotifications(
          new Request('http://localhost/api/notifications?limit=25') as never
        )
      ).status
    ).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith('owner-1', { limit: 25 });
    expect(
      (
        await listNotifications(
          new Request('http://localhost/api/notifications?limit=1000') as never
        )
      ).status
    ).toBe(400);
  });

  it('rejects client-selected recipients and event types in preferences', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    const response = await patchPreferences(
      new Request('http://localhost/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          billingAlerts: false,
          recipientEmail: 'other@example.test',
          type: 'RUN_FAILED',
        }),
      }) as never
    );
    expect(response.status).toBe(400);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('uses both owner and notification id when marking read', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    mocks.read.mockResolvedValue(false);
    const response = await markRead(new Request('http://localhost') as never, {
      params: Promise.resolve({ id: 'foreign-id' }),
    });
    expect(response.status).toBe(404);
    expect(mocks.read).toHaveBeenCalledWith('owner-1', 'foreign-id');
  });
});
