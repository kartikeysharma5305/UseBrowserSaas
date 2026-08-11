import { NextResponse } from 'next/server';

import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { checkReadiness } from '@/lib/operations/health';

export async function GET(request: Request) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  const readiness = await checkReadiness();
  return NextResponse.json(readiness, {
    status: readiness.status === 'ready' ? 200 : 503,
    headers: internalResponseHeaders(),
  });
}
