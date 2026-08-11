import 'server-only';

import type { BetaAccessStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export async function setBetaUserState(
  userId: string,
  state: Exclude<BetaAccessStatus, 'NONE'>
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, planSource: true },
    });
    if (!user) return null;
    if (state === 'ENDED') {
      await tx.schedule.updateMany({
        where: { userId, state: 'ENABLED' },
        data: { state: 'PAUSED', nextRunAt: null, version: { increment: 1 } },
      });
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        betaAccessStatus: state,
        betaActivatedAt: state === 'ACTIVE' ? now : undefined,
        betaEndedAt:
          state === 'ENDED' ? now : state === 'ACTIVE' ? null : undefined,
        ...(state === 'ENDED' && user.planSource === 'MANUAL'
          ? {
              planCode: 'FREE' as const,
              planSource: 'DEFAULT' as const,
              planAssignedAt: now,
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        betaAccessStatus: true,
        planCode: true,
        betaActivatedAt: true,
        betaEndedAt: true,
      },
    });
  });
}

export async function getBetaOperationsSnapshot() {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [invites, users, feedback, runRows, funnel] = await Promise.all([
    prisma.betaInvite.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        email: true,
        tokenPrefix: true,
        status: true,
        planCode: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    }),
    prisma.user.findMany({
      where: { betaAccessStatus: { not: 'NONE' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        email: true,
        name: true,
        betaAccessStatus: true,
        planCode: true,
        betaActivatedAt: true,
        betaEndedAt: true,
        createdAt: true,
        _count: {
          select: { agents: true, schedules: true, betaFeedback: true },
        },
      },
    }),
    prisma.betaFeedback.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        userId: true,
        category: true,
        message: true,
        contextPath: true,
        status: true,
        releaseVersion: true,
        createdAt: true,
        runId: true,
      },
    }),
    prisma.run.findMany({
      where: {
        createdAt: { gte: since },
        agent: { user: { betaAccessStatus: { not: 'NONE' } } },
      },
      select: {
        status: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        attempt: true,
        lastFailureCode: true,
        structuredStatus: true,
      },
      take: 1000,
    }),
    Promise.all([
      prisma.betaInvite.count(),
      prisma.betaInvite.count({ where: { status: 'ACCEPTED' } }),
      prisma.user.count({ where: { betaAccessStatus: { not: 'NONE' } } }),
      prisma.user.count({
        where: { betaAccessStatus: { not: 'NONE' }, agents: { some: {} } },
      }),
      prisma.user.count({
        where: {
          betaAccessStatus: { not: 'NONE' },
          agents: { some: { runs: { some: {} } } },
        },
      }),
      prisma.user.count({
        where: {
          betaAccessStatus: { not: 'NONE' },
          agents: { some: { runs: { some: { status: 'SUCCESS' } } } },
        },
      }),
    ]),
  ]);
  const completed = runRows.filter((run) =>
    ['SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELED'].includes(run.status)
  );
  const durations = completed
    .map((run) =>
      run.completedAt && run.startedAt
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : 0
    )
    .filter(Boolean)
    .sort((a, b) => a - b);
  const failureCategories = Object.fromEntries(
    runRows
      .filter((r) => r.lastFailureCode)
      .reduce((map, row) => {
        const code = row.lastFailureCode ?? 'UNKNOWN';
        const group = /DOMAIN|NETWORK|REDIRECT|SAFETY/.test(code)
          ? 'safety'
          : /TIMEOUT|LEASE/.test(code)
            ? 'timeout'
            : /QUOTA|LIMIT|PLAN/.test(code)
              ? 'quota'
              : /PROVIDER|MODEL/.test(code)
                ? 'provider'
                : 'execution';
        map.set(group, (map.get(group) ?? 0) + 1);
        return map;
      }, new Map<string, number>())
  );
  return {
    generatedAt: new Date().toISOString(),
    invites,
    users,
    feedback,
    funnel: {
      invited: funnel[0],
      accepted: funnel[1],
      registered: funnel[2],
      createdAgent: funnel[3],
      attemptedRun: funnel[4],
      firstSuccess: funnel[5],
    },
    reliability24h: {
      runs: runRows.length,
      completed: runRows.filter((r) => r.status === 'SUCCESS').length,
      failed: runRows.filter((r) => r.status === 'FAILED').length,
      canceled: runRows.filter((r) => r.status === 'CANCELED').length,
      retryAttempts: runRows.reduce(
        (n, r) => n + Math.max(r.attempt - 1, 0),
        0
      ),
      medianDurationMs: durations.length
        ? durations[Math.floor(durations.length / 2)]
        : null,
      structuredInvalid: runRows.filter((r) => r.structuredStatus === 'INVALID')
        .length,
      failureCategories,
    },
  };
}
