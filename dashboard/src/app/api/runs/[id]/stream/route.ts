import { NextRequest } from 'next/server';

import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import {
  toAgentEventRecord,
  toClientJsonValue,
  toRunApiRecord,
  toRunArtifactRecord,
} from '@/lib/api/run-record';
import { runIdSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/db/prisma';
import { sanitizePersistedExecutionError } from '@/lib/execution/errors';
import { isTerminalRunStatus } from '@/lib/execution/run-state';
import { presentRunDuration } from '@/lib/runs/duration';
import { acquireStreamLease } from '@/lib/realtime/connection-limits';
import { getRealtimeConfiguration } from '@/lib/realtime/config';
import { RunNotificationSubscriber } from '@/lib/realtime/run-notifications';
import {
  RUN_STREAM_VERSION,
  type RunStreamAgentEvent,
  type RunStreamArtifact,
  type RunStreamSnapshot,
  type RunStreamStatus,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const encoder = new TextEncoder();

function cursorFrom(request: NextRequest): number | null {
  const raw =
    request.headers.get('last-event-id') ??
    request.nextUrl.searchParams.get('afterSequence') ??
    '0';
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

function frame(event: string, data: unknown, id?: number): Uint8Array {
  return encoder.encode(
    `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);

  const parsedId = runIdSchema.safeParse(await params);
  if (!parsedId.success) return jsonError('Run not found.', 404);
  const cursor = cursorFrom(request);
  if (cursor === null) return jsonError('Invalid event cursor.', 400);

  const initialRun = await prisma.run.findFirst({
    where: { id: parsedId.data.id, agent: { userId: user.id } },
    include: {
      agent: true,
      events: false,
      artifacts: false,
    },
  });
  if (!initialRun) return jsonError('Run not found.', 404);

  const configuration = getRealtimeConfiguration();
  const lease = acquireStreamLease(
    user.id,
    initialRun.id,
    configuration.maxConnectionsPerUser,
    configuration.maxConnectionsPerRun
  );
  if (!lease) {
    return jsonError(
      'Too many live run connections.',
      429,
      'SSE_CONNECTION_LIMIT'
    );
  }

  let cancelStream = () => lease.release();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const subscriber = new RunNotificationSubscriber();
      let closed = false;
      let eventCursor = cursor;
      let flushing = false;
      let flushAgain = false;
      const sentArtifacts = new Set<string>();
      let lastStatus = initialRun.status;
      let lastCancelRequestedAt =
        initialRun.cancelRequestedAt?.toISOString() ?? null;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let fallback: ReturnType<typeof setInterval> | undefined;
      let maximumDuration: ReturnType<typeof setTimeout> | undefined;

      const send = (event: string, data: unknown, id?: number) => {
        if (!closed) controller.enqueue(frame(event, data, id));
      };
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (fallback) clearInterval(fallback);
        if (maximumDuration) clearTimeout(maximumDuration);
        request.signal.removeEventListener('abort', onAbort);
        lease.release();
        await subscriber.close();
      };
      const close = async (reason: string) => {
        if (closed) return;
        send('stream-end', { version: RUN_STREAM_VERSION, reason });
        await cleanup();
        try {
          controller.close();
        } catch {
          // The client may already have disconnected.
        }
      };
      const flush = async () => {
        if (closed) return;
        if (flushing) {
          flushAgain = true;
          return;
        }
        flushing = true;
        try {
          do {
            flushAgain = false;
            const run = await prisma.run.findFirst({
              where: { id: initialRun.id, agent: { userId: user.id } },
              include: {
                agent: true,
                events: {
                  where: { sequence: { gt: eventCursor } },
                  orderBy: { sequence: 'asc' },
                },
                artifacts: {
                  where: {
                    OR: [
                      { eventSequence: null },
                      { eventSequence: { gt: eventCursor } },
                    ],
                  },
                  orderBy: [{ eventSequence: 'asc' }, { createdAt: 'asc' }],
                },
              },
            });
            if (!run) {
              await close('run-unavailable');
              return;
            }

            for (const artifact of run.artifacts) {
              if (sentArtifacts.has(artifact.id)) continue;
              const record = toRunArtifactRecord(artifact);
              if (!record) continue;
              sentArtifacts.add(record.id);
              send('run-artifact', {
                version: RUN_STREAM_VERSION,
                artifact: record,
              } satisfies RunStreamArtifact);
            }
            for (const event of run.events) {
              const record = toAgentEventRecord(event);
              send(
                'agent-event',
                {
                  version: RUN_STREAM_VERSION,
                  event: record,
                } satisfies RunStreamAgentEvent,
                event.sequence
              );
              eventCursor = event.sequence;
            }

            if (
              lastStatus !== run.status ||
              (run.cancelRequestedAt?.toISOString() ?? null) !==
                lastCancelRequestedAt ||
              isTerminalRunStatus(run.status)
            ) {
              const duration = presentRunDuration(run);
              lastStatus = run.status;
              lastCancelRequestedAt =
                run.cancelRequestedAt?.toISOString() ?? null;
              send('run-status', {
                version: RUN_STREAM_VERSION,
                runId: run.id,
                status: run.status,
                startedAt: duration.startedAt.toISOString(),
                completedAt: run.completedAt?.toISOString() ?? null,
                duration: duration.duration,
                attemptDuration: duration.attemptDuration,
                result: toClientJsonValue(run.result),
                errorMessage: sanitizePersistedExecutionError(run.errorMessage),
                cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
                canceledAt: run.canceledAt?.toISOString() ?? null,
                cancelReason: run.cancelReason?.slice(0, 240) ?? null,
              } satisfies RunStreamStatus);
            }
            if (isTerminalRunStatus(run.status)) {
              await close('terminal');
              return;
            }
          } while (flushAgain && !closed);
        } finally {
          flushing = false;
        }
      };
      const onAbort = () => void cleanup();
      cancelStream = onAbort;
      request.signal.addEventListener('abort', onAbort, { once: true });

      const snapshotSource = {
        ...initialRun,
        events: [],
        artifacts: [],
      };
      send('snapshot', {
        version: RUN_STREAM_VERSION,
        run: toRunApiRecord(snapshotSource),
      } satisfies RunStreamSnapshot);

      heartbeat = setInterval(() => {
        send('heartbeat', {
          version: RUN_STREAM_VERSION,
          at: new Date().toISOString(),
        });
      }, configuration.heartbeatMs);
      fallback = setInterval(() => void flush(), configuration.fallbackPollMs);
      maximumDuration = setTimeout(
        () => void close('max-duration'),
        configuration.maxConnectionDurationMs
      );

      void subscriber
        .start((notification) => {
          if (notification.runId === initialRun.id) void flush();
        })
        .finally(() => void flush());
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}
