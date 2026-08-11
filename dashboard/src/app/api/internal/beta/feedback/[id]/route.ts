import { z } from 'zod';
import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { updateBetaFeedbackStatus } from '@/lib/beta/feedback';
const schema = z
  .object({ status: z.enum(['NEW', 'REVIEWING', 'RESOLVED', 'WONT_FIX']) })
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
      { error: 'Invalid feedback status.' },
      { status: 400, headers: internalResponseHeaders() }
    );
  try {
    return Response.json(
      {
        data: await updateBetaFeedbackStatus(
          (await params).id,
          parsed.data.status
        ),
      },
      { headers: internalResponseHeaders() }
    );
  } catch {
    return Response.json(
      { error: 'Feedback not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  }
}
