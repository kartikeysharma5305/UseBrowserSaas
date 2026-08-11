import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { getAvailableExecutionModels } from '@/lib/execution/model-catalogue';

export async function GET() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);

  return NextResponse.json({
    data: getAvailableExecutionModels().map((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
    })),
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
