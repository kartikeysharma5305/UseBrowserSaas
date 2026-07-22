import { NextResponse } from 'next/server';
import type { Agent, User } from '@prisma/client';
import { ZodError, type ZodType } from 'zod';

import { getCurrentUser } from '@/lib/auth/helpers';
import { prisma } from '@/lib/db/prisma';

/**
 * Helper to return a JSON error response
 */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Extract validation errors from Zod schema and return formatted response
 */
export function handleValidationError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError(
      error.issues.map((issue) => issue.message).join(', '),
      400
    );
  }

  return jsonError('Validation failed.', 400);
}

/**
 * Get the current authenticated user from session
 * Returns null if not authenticated
 */
export async function requireAuthenticatedUser(): Promise<User | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return user as User;
}

/**
 * Check if a user owns a specific agent
 * Returns the agent if access is granted, null otherwise
 * This prevents users from accessing other users' agents
 */
export async function verifyAgentAccess(agentId: string, userId: string) {
  return prisma.agent.findFirst({
    where: {
      id: agentId,
      userId,
    },
  });
}

/**
 * Require that the user owns the agent, throw error if not
 * Used in API routes that modify or delete agents
 */
export async function requireAgentOwnership(
  agentId: string,
  userId: string
): Promise<Agent> {
  const agent = await verifyAgentAccess(agentId, userId);

  if (!agent) {
    throw new Error('Agent not found or access denied.');
  }

  return agent;
}

/**
 * Check if a user owns a specific run record
 * Through ownership of the agent that created the run
 * Returns the run with related agent and events
 */
export async function verifyRunAccess(runId: string, userId: string) {
  return prisma.run.findFirst({
    where: {
      id: runId,
      agent: {
        userId,
      },
    },
    include: {
      agent: true,
      events: true,
    },
  });
}

/**
 * Require that the user owns the run, throw error if not
 */
export async function requireRunOwnership(runId: string, userId: string) {
  const run = await verifyRunAccess(runId, userId);

  if (!run) {
    throw new Error('Run not found or access denied.');
  }

  return run;
}

export const getOwnedAgent = verifyAgentAccess;
export const getOwnedRun = verifyRunAccess;

/**
 * Safely parse and validate request body using Zod schema
 * Returns either validated data or a NextResponse error
 * Handles JSON parsing errors and validation failures
 */
export async function parseValidatedBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const payload = await request.json();
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      return {
        ok: false,
        response: handleValidationError(parsed.error),
      };
    }

    return {
      ok: true,
      data: parsed.data,
    };
  } catch {
    return {
      ok: false,
      response: jsonError('Invalid request body.', 400),
    };
  }
}
