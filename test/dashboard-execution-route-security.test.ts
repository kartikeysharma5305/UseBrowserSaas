import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { ExecutionServiceError } from '../dashboard/src/lib/execution/errors.js';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  verifyAgentAccess: vi.fn(),
  parseValidatedBody: vi.fn(),
  runAgent: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api/route-helpers', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuthenticatedUser: mocks.requireAuthenticatedUser,
    verifyAgentAccess: mocks.verifyAgentAccess,
    parseValidatedBody: mocks.parseValidatedBody,
    handleValidationError: vi.fn(() =>
      NextResponse.json({ error: 'Validation failed.' }, { status: 400 })
    ),
    jsonError: vi.fn(
      (
        message: string,
        status: number,
        code?: string,
        details?: { activeRunId?: string }
      ) =>
        NextResponse.json(
          code ? { error: message, code, ...details } : { error: message },
          { status }
        )
    ),
  };
});

vi.mock('@/lib/execution/prisma-agent-execution-service', () => ({
  PrismaAgentExecutionService: class {
    runAgent = mocks.runAgent;
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

import { POST } from '../dashboard/src/app/api/agents/[id]/run/route.js';

function request() {
  return new NextRequest('http://localhost:3001/api/agents/agent-1/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function context(id = 'agent-1') {
  return { params: Promise.resolve({ id }) };
}

describe('execution route security contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({ id: 'user-1' });
    mocks.verifyAgentAccess.mockResolvedValue({ id: 'agent-1' });
    mocks.parseValidatedBody.mockResolvedValue({ ok: true, data: {} });
  });

  it('retains route-level ownership verification', async () => {
    mocks.verifyAgentAccess.mockResolvedValue(null);

    const response = await POST(request(), context());

    expect(mocks.verifyAgentAccess).toHaveBeenCalledWith('agent-1', 'user-1');
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Agent not found.',
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('passes only the authenticated session user ID to the service', async () => {
    mocks.runAgent.mockResolvedValue({
      runId: 'run-1',
      status: 'QUEUED',
      detailsUrl: '/dashboard/runs/run-1',
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    expect(mocks.runAgent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    });
  });

  it('maps inaccessible and missing route lookups identically', async () => {
    mocks.verifyAgentAccess.mockResolvedValue(null);

    const first = await POST(request(), context('missing-agent'));
    const second = await POST(request(), context('cross-user-agent'));

    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());
  });

  it('maps invalid stored configuration to a safe 400 response', async () => {
    mocks.runAgent.mockRejectedValue(
      new ExecutionServiceError('INVALID_AGENT_CONFIGURATION', {
        cause: new Error('Invalid internal model value'),
        stage: 'configuration',
      })
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'This agent has an invalid execution configuration.',
      code: 'INVALID_AGENT_CONFIGURATION',
    });
  });

  it('maps unavailable execution infrastructure to a safe 503 response', async () => {
    mocks.runAgent.mockRejectedValue(
      new ExecutionServiceError('EXECUTION_UNAVAILABLE', {
        cause: new Error('GROQ_API_KEY missing'),
        stage: 'llm_create',
        runId: 'run-1',
      })
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Agent execution is temporarily unavailable.',
      code: 'EXECUTION_UNAVAILABLE',
    });
  });

  it('returns a safe duplicate conflict with only the active run ID', async () => {
    mocks.runAgent.mockRejectedValue(
      new ExecutionServiceError('AGENT_RUN_ALREADY_ACTIVE', {
        stage: 'run_create',
        activeRunId: 'run-active',
      })
    );

    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This agent already has an active run.',
      code: 'AGENT_RUN_ALREADY_ACTIVE',
      activeRunId: 'run-active',
    });
  });

  it('returns a safe per-user concurrency response without activity details', async () => {
    mocks.runAgent.mockRejectedValue(
      new ExecutionServiceError('USER_RUN_LIMIT_REACHED', {
        stage: 'run_create',
      })
    );

    const response = await POST(request(), context());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'You have reached the active run limit. Try again later.',
      code: 'USER_RUN_LIMIT_REACHED',
    });
  });

  it('does not return raw database, provider, path, or stack details', async () => {
    mocks.runAgent.mockRejectedValue(
      new Error(
        'Prisma postgresql://u:p@db/name failed at C:\\private\\engine.js with gsk_providersecret'
      )
    );

    const response = await POST(request(), context());
    const body = await response.json();
    const returned = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error:
        'The agent run failed. Review the run details for more information.',
      code: 'EXECUTION_FAILED',
    });
    expect(returned).not.toContain('Prisma');
    expect(returned).not.toContain('postgresql');
    expect(returned).not.toContain('C:\\private');
    expect(returned).not.toContain('gsk_providersecret');
  });

  it('logs a sanitized internal cause for unexpected failures', async () => {
    mocks.runAgent.mockRejectedValue(
      new Error('Failure at C:\\private\\engine.js with gsk_providersecret')
    );

    await POST(request(), context());

    expect(mocks.logger.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(mocks.logger.error.mock.calls);
    expect(logged).not.toContain('C:\\private');
    expect(logged).not.toContain('gsk_providersecret');
    expect(logged).toContain('EXECUTION_FAILED');
  });
});
