import { NextResponse } from 'next/server';

import {
  authorizeOperatorRequest,
  internalResponseHeaders,
} from '@/lib/operations/access';
import { renderPrometheus } from '@/lib/operations/metrics';
import {
  collectOperationsSnapshot,
  snapshotPrometheusSamples,
} from '@/lib/operations/snapshot';

export async function GET(request: Request) {
  if (!(await authorizeOperatorRequest(request)).ok)
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: internalResponseHeaders() }
    );
  try {
    const snapshot = await collectOperationsSnapshot();
    return new NextResponse(
      renderPrometheus(snapshotPrometheusSamples(snapshot)),
      {
        headers: {
          ...internalResponseHeaders(),
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Operational metrics are temporarily unavailable.' },
      { status: 503, headers: internalResponseHeaders() }
    );
  }
}
