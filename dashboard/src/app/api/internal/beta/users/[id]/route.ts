import { z } from 'zod';
import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { setBetaUserState } from '@/lib/beta/operations';
const schema = z
  .object({ state: z.enum(['ACTIVE', 'SUSPENDED', 'ENDED']) })
  .strict();
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return Response.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: 'Invalid beta state.' },
      { status: 400, headers: internalResponseHeaders() }
    );
  const result = await setBetaUserState((await params).id, parsed.data.state);
  return result
    ? Response.json({ data: result }, { headers: internalResponseHeaders() })
    : Response.json(
        { error: 'Beta user not found.' },
        { status: 404, headers: internalResponseHeaders() }
      );
}
