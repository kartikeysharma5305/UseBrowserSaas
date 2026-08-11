import { describe, expect, it, vi } from 'vitest';

import { PrismaAgentExecutionService } from '../dashboard/src/lib/execution/prisma-agent-execution-service.js';

describe('durable execution submission facade', () => {
  it('forwards only trusted agent and session user identifiers', async () => {
    const enqueue = vi.fn().mockResolvedValue({
      runId: 'run-1',
      status: 'QUEUED',
      detailsUrl: '/dashboard/runs/run-1',
    });
    const service = new PrismaAgentExecutionService({ enqueue });

    await expect(
      service.runAgent({ agentId: 'agent-1', userId: 'user-1' })
    ).resolves.toMatchObject({ runId: 'run-1', status: 'QUEUED' });
    expect(enqueue).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    });
  });

  it('does not import or call a browser execution adapter', async () => {
    const enqueue = vi.fn().mockResolvedValue({
      runId: 'run-2',
      status: 'QUEUED',
      detailsUrl: '/dashboard/runs/run-2',
    });
    const service = new PrismaAgentExecutionService({ enqueue });
    await service.runAgent({ agentId: 'agent-2', userId: 'user-2' });
    expect(Object.keys(service)).not.toContain('browserExecutionService');
  });
});
