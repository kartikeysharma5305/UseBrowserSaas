import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  onboardingUpsert: vi.fn(),
}));
vi.mock('@/lib/agents/service', () => ({
  createOwnedAgent: mocks.createAgent,
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { onboardingState: { upsert: mocks.onboardingUpsert } },
}));

import {
  createAgentFromTemplate,
  TemplateNotFoundError,
} from '@/lib/templates/service';

describe('Phase 8 trusted Agent creation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Customized',
      description: null,
      goal: 'Goal',
      targetWebsite: 'https://example.com',
      status: 'ACTIVE',
      configuration: {},
    });
    mocks.onboardingUpsert.mockResolvedValue({});
  });

  it('creates an ordinary owner-scoped Agent with server-controlled defaults', async () => {
    const execution = { runAgent: vi.fn() };
    const result = await createAgentFromTemplate(
      { id: 'owner-1', planCode: 'FREE' },
      'competitor-page-monitor',
      {
        name: 'Customized',
        description: 'Safe description',
        goal: 'Review the page and stop.',
        targetWebsite: 'https://example.com',
        createAndTest: false,
      },
      execution as never
    );
    expect(mocks.createAgent).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        name: 'Customized',
        goal: 'Review the page and stop.',
        targetWebsite: 'https://example.com',
        status: 'ACTIVE',
        scheduleType: 'MANUAL',
        configuration: expect.objectContaining({
          maxSteps: 25,
          timeoutMs: 120_000,
        }),
      })
    );
    const configuration = mocks.createAgent.mock.calls[0][1].configuration;
    expect(configuration.model).toBe('groq_llama-3.3-70b-versatile');
    expect(result.run).toBeNull();
    expect(execution.runAgent).not.toHaveBeenCalled();
  });

  it('uses the existing admission facade for Create and test', async () => {
    const execution = {
      runAgent: vi.fn().mockResolvedValue({
        runId: 'run-1',
        status: 'QUEUED',
        detailsUrl: '/dashboard/runs/run-1',
      }),
    };
    const result = await createAgentFromTemplate(
      { id: 'owner-1', planCode: 'PRO' },
      'competitor-page-monitor',
      {
        name: 'Agent',
        goal: 'Review and stop.',
        targetWebsite: 'https://example.com',
        createAndTest: true,
      },
      execution as never
    );
    expect(execution.runAgent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'owner-1',
    });
    expect(result.run).toMatchObject({ runId: 'run-1', status: 'QUEUED' });
    expect(mocks.createAgent.mock.calls[0][1].configuration).toMatchObject({
      maxSteps: 40,
      timeoutMs: 180_000,
    });
  });

  it('preserves the created Agent when admission fails', async () => {
    const execution = {
      runAgent: vi.fn().mockRejectedValue(new Error('internal quota detail')),
    };
    const result = await createAgentFromTemplate(
      { id: 'owner-1', planCode: 'FREE' },
      'webpage-summarizer',
      {
        name: 'Agent',
        goal: 'Summarize and stop.',
        targetWebsite: 'https://example.com',
        createAndTest: true,
      },
      execution as never
    );
    expect(mocks.createAgent).toHaveBeenCalledOnce();
    expect(result.agent.id).toBe('agent-1');
    expect(result.run).toBeNull();
    expect(result.runAdmissionError).not.toContain('internal quota detail');
  });

  it('rejects unknown template identities before creating anything', async () => {
    await expect(
      createAgentFromTemplate({ id: 'owner-1', planCode: 'FREE' }, 'unknown', {
        name: 'Agent',
        goal: 'Goal',
        targetWebsite: 'https://example.com',
        createAndTest: false,
      })
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});
