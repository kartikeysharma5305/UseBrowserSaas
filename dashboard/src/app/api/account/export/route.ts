import { NextResponse } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import {
  createUserDataExport,
  DataExportTooLargeError,
  DataExportUnavailableError,
} from '@/lib/data-governance/export';
import {
  consumeSecurityLimit,
  securityIdentifier,
} from '@/lib/security/rate-limit';

export async function POST() {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  try {
    const limit = await consumeSecurityLimit({
      namespace: 'account-export',
      subject: securityIdentifier(user.id),
      limit: 2,
      windowMs: 60 * 60 * 1_000,
    });
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'Data export rate limit reached.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfter) },
        }
      );
    const value = await createUserDataExport(user.id);
    return new NextResponse(value.json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="browser-use-data-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof DataExportUnavailableError)
      return jsonError(
        'Data export is unavailable after account deletion begins.',
        409,
        'ACCOUNT_DELETION_PENDING'
      );
    if (error instanceof DataExportTooLargeError)
      return jsonError(
        'This export exceeds the synchronous export limit. Contact privacy support.',
        413,
        'EXPORT_TOO_LARGE'
      );
    return jsonError('Data export is temporarily unavailable.', 503);
  }
}
