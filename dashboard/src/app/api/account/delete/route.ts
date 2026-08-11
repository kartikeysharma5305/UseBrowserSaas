import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  jsonError,
  parseValidatedBody,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import {
  AccountDeletionConfirmationError,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from '@/lib/account-deletion';

const schema = z.object({ confirmation: z.literal('DELETE') });

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const body = await parseValidatedBody(request, schema);
  if (!body.ok) return body.response;
  try {
    const operation = await requestAccountDeletion(
      user.id,
      body.data.confirmation
    );
    return NextResponse.json(
      { data: { status: operation.status, stage: operation.stage } },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof AccountDeletionConfirmationError)
      return jsonError(
        'Confirmation phrase is required.',
        400,
        'CONFIRMATION_REQUIRED'
      );
    return jsonError(
      'Unable to process account deletion.',
      500,
      'ACCOUNT_DELETION_FAILED'
    );
  }
}

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  return NextResponse.json({ data: await getAccountDeletionStatus(user.id) });
}
