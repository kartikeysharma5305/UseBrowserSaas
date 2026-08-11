import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn(),
}));

vi.mock('@/lib/api/route-helpers', () => ({
  requireAuthenticatedUser: mocks.requireUser,
  jsonError: (message: string, status = 400, code?: string) =>
    Response.json(code ? { error: message, code } : { error: message }, {
      status,
    }),
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
vi.mock('@/lib/scheduling/service', async (original) => ({
  ...(await original<
    typeof import('../dashboard/src/lib/scheduling/service.js')
  >()),
  createSchedule: mocks.createSchedule,
  listSchedules: mocks.listSchedules,
}));

import { GET, POST } from '../dashboard/src/app/api/schedules/route.js';

describe('Phase 6C schedule API authorization and validation', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects unauthenticated list and create requests', async () => {
    mocks.requireUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(
      (
        await POST(
          new Request('http://localhost/api/schedules', {
            method: 'POST',
            body: '{}',
          }) as any
        )
      ).status
    ).toBe(401);
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });

  it('derives the owner only from the authenticated session', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    mocks.createSchedule.mockResolvedValue({ id: 'schedule-1' });
    const request = new Request('http://localhost/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        kind: 'ONCE',
        timezone: 'UTC',
        oneTimeAt: '2027-01-01T00:00:00Z',
      }),
    });
    expect((await POST(request as any)).status).toBe(201);
    expect(mocks.createSchedule).toHaveBeenCalledWith(
      'owner-1',
      expect.not.objectContaining({ userId: expect.anything() })
    );
  });

  it('returns safe validation errors without invoking persistence', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    const request = new Request('http://localhost/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        kind: 'WEEKLY',
        timezone: 'invalid-zone',
        localTime: '99:99',
        weekdays: [8],
        userId: 'other-user',
      }),
    });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
    expect(mocks.createSchedule).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('Prisma');
  });

  it('lists only through the authenticated owner-scoped service boundary', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    mocks.listSchedules.mockResolvedValue([]);
    expect((await GET()).status).toBe(200);
    expect(mocks.listSchedules).toHaveBeenCalledWith('owner-1');
  });
});
