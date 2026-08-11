import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { templateIdSchema } from '@/lib/templates/schemas';
import {
  getTemplateForPlan,
  TemplateNotFoundError,
} from '@/lib/templates/service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = templateIdSchema.safeParse(await params);
  if (!parsed.success) return handleValidationError(parsed.error);
  try {
    return NextResponse.json({
      data: getTemplateForPlan(parsed.data.id, user.planCode),
    });
  } catch (error) {
    if (error instanceof TemplateNotFoundError)
      return jsonError('Template not found.', 404);
    return jsonError('Unable to load template.', 500);
  }
}
