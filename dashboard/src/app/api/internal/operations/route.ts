import { NextResponse } from 'next/server';

import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { collectOperationsSnapshot } from '@/lib/operations/snapshot';

export async function GET(request: Request) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  try {
    return NextResponse.json(await collectOperationsSnapshot(), {
      headers: internalResponseHeaders(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Operational snapshot is temporarily unavailable.' },
      { status: 503, headers: internalResponseHeaders() }
    );
  }
}
