import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { revokeBetaInvite } from '@/lib/beta/invites';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return Response.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  const result = await revokeBetaInvite((await params).id);
  return result.count
    ? Response.json(
        { data: { revoked: true } },
        { headers: internalResponseHeaders() }
      )
    : Response.json(
        { error: 'Invitation not found.' },
        { status: 404, headers: internalResponseHeaders() }
      );
}
