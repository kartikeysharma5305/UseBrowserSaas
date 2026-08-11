import { NextResponse } from 'next/server';

import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';

export async function GET(request: Request) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  return NextResponse.json(
    { status: 'ok', process: 'dashboard' },
    { headers: internalResponseHeaders() }
  );
}
