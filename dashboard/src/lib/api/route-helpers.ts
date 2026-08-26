import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { ZodError, type ZodType } from 'zod';

import { getCurrentUser } from '@/lib/auth/helpers';
import { prisma } from '@/lib/db/prisma';
import { SECURITY_POLICY, validateJsonShape } from '@/lib/security/policy';
import { recordSecurityRejection } from '@/lib/operations/signals';

/**
 * Helper to return a JSON error response
 */
export function jsonError(
  message: string,
  status = 400,
  code?: string,
  details?: { activeRunId?: string }
) {
  return NextResponse.json(
    code ? { error: message, code, ...details } : { error: message },
    { status }
  );
}

/**
 * Extract validation errors from Zod schema and return formatted response
 */
export function handleValidationError(error: unknown) {
  if (error instanceof ZodError) {
    const messages = error.issues.slice(0, 3).map((issue) => {
      const lastField = [...issue.path]
        .reverse()
        .find((part): part is string => typeof part === 'string');
      const label = lastField
        ? lastField
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/^./, (character) => character.toUpperCase())
        : 'Request';
      const entry = issue.path.find(
        (part): part is number => typeof part === 'number'
      );

      if (
        (lastField === 'allowedDomains' || lastField === 'blockedDomains') &&
        entry !== undefined &&
        issue.code === 'too_small'
      )
        return `${label} contains an empty entry.`;

      return `${label}${entry === undefined ? '' : ` entry ${entry + 1}`}: ${issue.message}`;
    });

    return jsonError(messages.join(' '), 400);
  }

  return jsonError('Validation failed.', 400);
}

/**
 * Get the current authenticated user from session
 * Returns null if not authenticated
 */
export async function requireAuthenticatedUser(): Promise<User | null> {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return null;
  }

  return prisma.user.findUnique({ where: { id: sessionUser.id } });
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
      events: {
        orderBy: [{ sequence: 'asc' }, { timestamp: 'asc' }],
      },
      artifacts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

/**
 * Safely parse and validate request body using Zod schema
 * Returns either validated data or a NextResponse error
 * Handles JSON parsing errors and validation failures
 */
export async function parseValidatedBody<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = SECURITY_POLICY.bodyBytes.authenticatedJson
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return {
      ok: false,
      response: jsonError('Content-Type must be application/json.', 415),
    };
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    recordSecurityRejection('oversized_body');
    return {
      ok: false,
      response: jsonError('Request body is too large.', 413),
    };
  }
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      recordSecurityRejection('oversized_body');
      return {
        ok: false,
        response: jsonError('Request body is too large.', 413),
      };
    }
    const payload = JSON.parse(text);
    if (!validateJsonShape(payload))
      return {
        ok: false,
        response: jsonError('Request body is too complex.', 413),
      };
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
