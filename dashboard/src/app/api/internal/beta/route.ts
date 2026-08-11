import { z } from 'zod';
import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { createBetaInvite } from '@/lib/beta/invites';
import { getBetaOperationsSnapshot } from '@/lib/beta/operations';

const schema = z
  .object({
    email: z.string().email().max(320),
    planCode: z.enum(['FREE', 'PRO']).default('FREE'),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const denied = () =>
  Response.json(
    { error: 'Not found.' },
    { status: 404, headers: internalResponseHeaders() }
  );

export async function GET(request: Request) {
  if (!(await authorizeOperatorRequest(request)).ok) return denied();
  try {
    return Response.json(await getBetaOperationsSnapshot(), {
      headers: internalResponseHeaders(),
    });
  } catch {
    return Response.json(
      { error: 'Beta operations are temporarily unavailable.' },
      { status: 503, headers: internalResponseHeaders() }
    );
  }
}

export async function POST(request: Request) {
  const operator = await authorizeOperatorRequest(request);
  if (!operator.ok) return denied();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: 'Invalid invitation request.' },
      { status: 400, headers: internalResponseHeaders() }
    );
  try {
    const created = await createBetaInvite({
      ...parsed.data,
      invitedByUserId:
        operator.via === 'session' ? operator.user.id : undefined,
    });
    return Response.json(
      { data: { ...created.invite, inviteToken: created.token } },
      { status: 201, headers: internalResponseHeaders() }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message === 'BETA_CAPACITY_REACHED'
            ? 'Closed beta capacity has been reached.'
            : 'Invitation could not be created.',
      },
      {
        status:
          error instanceof Error && error.message === 'BETA_CAPACITY_REACHED'
            ? 409
            : 503,
        headers: internalResponseHeaders(),
      }
    );
  }
}
