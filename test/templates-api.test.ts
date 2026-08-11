import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  deleting: vi.fn(),
  getOnboarding: vi.fn(),
  updateOnboarding: vi.fn(),
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
vi.mock('@/lib/templates/service', () => ({
  listTemplatesForPlan: mocks.list,
  getTemplateForPlan: mocks.get,
  createAgentFromTemplate: mocks.create,
  TemplateNotFoundError: class TemplateNotFoundError extends Error {},
}));
vi.mock('@/lib/account-deletion', () => ({
  isAccountDeletionPending: mocks.deleting,
}));
vi.mock('@/lib/onboarding/service', () => ({
  getOnboarding: mocks.getOnboarding,
  updateOnboarding: mocks.updateOnboarding,
}));

import { GET as listTemplates } from '@/app/api/templates/route';
import { POST as createTemplateAgent } from '@/app/api/templates/[id]/create-agent/route';
import {
  GET as getOnboarding,
  PATCH as patchOnboarding,
} from '@/app/api/onboarding/route';

describe('Phase 8 authenticated APIs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.deleting.mockResolvedValue(false);
  });

  it('rejects unauthenticated catalogue and onboarding access', async () => {
    mocks.requireUser.mockResolvedValue(null);
    expect((await listTemplates()).status).toBe(401);
    expect((await getOnboarding()).status).toBe(401);
  });

  it('derives catalogue plan only from the authenticated user', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1', planCode: 'FREE' });
    mocks.list.mockReturnValue({ templates: [] });
    expect((await listTemplates()).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith('FREE');
  });

  it('rejects arbitrary user, model, and hidden configuration fields', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1', planCode: 'FREE' });
    const request = new Request(
      'http://localhost/api/templates/webpage-summarizer/create-agent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent',
          goal: 'Summarize and stop.',
          targetWebsite: 'https://example.com',
          createAndTest: false,
          userId: 'other',
          model: 'client-model',
          configuration: { timeoutMs: 999999 },
        }),
      }
    );
    const response = await createTemplateAgent(request as never, {
      params: Promise.resolve({ id: 'webpage-summarizer' }),
    });
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('blocks template creation while account deletion is pending or failed', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1', planCode: 'FREE' });
    mocks.deleting.mockResolvedValue(true);
    const response = await createTemplateAgent(
      new Request('http://localhost', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ id: 'webpage-summarizer' }) }
    );
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('never accepts client-completed checklist milestones', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1' });
    const response = await patchOnboarding(
      new Request('http://localhost/api/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'COMPLETE',
          firstSuccessfulRunAt: new Date().toISOString(),
          userId: 'other',
        }),
      }) as never
    );
    expect(response.status).toBe(400);
    expect(mocks.updateOnboarding).not.toHaveBeenCalled();
  });

  it('passes only the authenticated owner into trusted creation', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'owner-1', planCode: 'PRO' });
    mocks.create.mockResolvedValue({
      agent: {
        id: 'agent-1',
        name: 'Agent',
        description: null,
        goal: 'Goal',
        targetWebsite: 'https://example.com',
        status: 'ACTIVE',
      },
      run: null,
      runAdmissionError: null,
      applied: { maxSteps: 20, timeoutMs: 90_000, adjusted: false },
    });
    const response = await createTemplateAgent(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent',
          goal: 'Goal',
          targetWebsite: 'https://example.com',
          createAndTest: false,
        }),
      }) as never,
      { params: Promise.resolve({ id: 'webpage-summarizer' }) }
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      { id: 'owner-1', planCode: 'PRO' },
      'webpage-summarizer',
      expect.not.objectContaining({
        userId: expect.anything(),
        model: expect.anything(),
      })
    );
    expect(JSON.stringify(await response.json())).not.toMatch(
      /configuration|model|userId|stack|Prisma/i
    );
  });
});
