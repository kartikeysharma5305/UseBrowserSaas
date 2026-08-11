import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stateFind: vi.fn(),
  stateCreate: vi.fn(),
  stateUpdate: vi.fn(),
  stateUpsert: vi.fn(),
  agentFind: vi.fn(),
  runFind: vi.fn(),
  scheduleFind: vi.fn(),
  preferenceFind: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    onboardingState: {
      findUnique: mocks.stateFind,
      create: mocks.stateCreate,
      update: mocks.stateUpdate,
      upsert: mocks.stateUpsert,
    },
    agent: { findFirst: mocks.agentFind },
    run: { findFirst: mocks.runFind },
    schedule: { findFirst: mocks.scheduleFind },
    notificationPreference: { findUnique: mocks.preferenceFind },
  },
}));

import { getOnboarding, updateOnboarding } from '@/lib/onboarding/service';

describe('Phase 8 authoritative onboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stateFind.mockResolvedValue(null);
    mocks.agentFind.mockResolvedValue(null);
    mocks.runFind.mockResolvedValue(null);
    mocks.scheduleFind.mockResolvedValue(null);
    mocks.preferenceFind.mockResolvedValue(null);
    mocks.stateCreate.mockImplementation(async ({ data }) => ({
      id: 'state-1',
      dismissedAt: null,
      selectedTemplateId: null,
      ...data,
    }));
  });

  it('shows onboarding for a genuinely new user', async () => {
    const result = await getOnboarding('user-1');
    expect(result.visible).toBe(true);
    expect(result.checklist).toMatchObject({
      accountReady: true,
      firstAgentCreatedAt: null,
      firstRunStartedAt: null,
    });
  });

  it('does not force an existing user without prior onboarding state', async () => {
    mocks.agentFind.mockResolvedValue({ createdAt: new Date('2026-01-01') });
    const result = await getOnboarding('user-1');
    expect(result.visible).toBe(false);
    expect(result.checklist.firstAgentCreatedAt).toBeInstanceOf(Date);
  });

  it('derives run and success milestones from owned Run records', async () => {
    const firstRun = new Date('2026-02-01');
    const success = new Date('2026-02-02');
    mocks.stateFind.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      visible: true,
      dismissedAt: null,
      completedAt: null,
      selectedTemplateId: null,
    });
    mocks.runFind
      .mockResolvedValueOnce({ createdAt: firstRun })
      .mockResolvedValueOnce({ completedAt: success });
    mocks.stateUpdate.mockResolvedValue({
      id: 'state-1',
      visible: false,
      dismissedAt: null,
      completedAt: success,
      selectedTemplateId: null,
    });
    const result = await getOnboarding('user-1');
    expect(result.checklist.firstRunStartedAt).toEqual(firstRun);
    expect(result.checklist.firstSuccessfulRunAt).toEqual(success);
    expect(result.completedAt).toEqual(success);
  });

  it('persists dismiss and reopen without accepting milestone flags', async () => {
    mocks.stateUpsert.mockResolvedValue({});
    await updateOnboarding('user-1', 'DISMISS');
    await updateOnboarding('user-1', 'REOPEN');
    expect(mocks.stateUpsert.mock.calls[0][0].update).toMatchObject({
      visible: false,
    });
    expect(mocks.stateUpsert.mock.calls[1][0].update).toMatchObject({
      visible: true,
    });
  });
});
