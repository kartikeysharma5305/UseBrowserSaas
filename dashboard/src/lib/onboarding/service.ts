import { prisma } from '@/lib/db/prisma';

export async function getOnboarding(userId: string) {
  const [state, firstAgent, firstRun, firstSuccess, firstSchedule, preference] =
    await Promise.all([
      prisma.onboardingState.findUnique({ where: { userId } }),
      prisma.agent.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.run.findFirst({
        where: { agent: { userId } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.run.findFirst({
        where: { agent: { userId }, status: 'SUCCESS' },
        orderBy: { completedAt: 'asc' },
        select: { completedAt: true },
      }),
      prisma.schedule.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.notificationPreference.findUnique({
        where: { userId },
        select: { updatedAt: true },
      }),
    ]);
  const inferredExisting = !state && Boolean(firstAgent || firstRun);
  let durable = state;
  if (!durable) {
    durable = await prisma.onboardingState.create({
      data: {
        userId,
        visible: !inferredExisting,
        completedAt: firstSuccess?.completedAt ?? null,
      },
    });
  } else if (firstSuccess?.completedAt && !durable.completedAt) {
    durable = await prisma.onboardingState.update({
      where: { userId },
      data: { completedAt: firstSuccess.completedAt, visible: false },
    });
  }
  return {
    visible: durable.visible,
    dismissedAt: durable.dismissedAt,
    completedAt: durable.completedAt,
    selectedTemplateId: durable.selectedTemplateId,
    checklist: {
      accountReady: true,
      firstAgentCreatedAt: firstAgent?.createdAt ?? null,
      firstRunStartedAt: firstRun?.createdAt ?? null,
      firstSuccessfulRunAt: firstSuccess?.completedAt ?? null,
      firstScheduleCreatedAt: firstSchedule?.createdAt ?? null,
      notificationPreferencesReviewedAt: preference?.updatedAt ?? null,
    },
  };
}

export async function updateOnboarding(
  userId: string,
  action: 'DISMISS' | 'REOPEN'
) {
  const now = new Date();
  return prisma.onboardingState.upsert({
    where: { userId },
    create: {
      userId,
      visible: action === 'REOPEN',
      dismissedAt: action === 'DISMISS' ? now : null,
      reopenedAt: action === 'REOPEN' ? now : null,
    },
    update:
      action === 'DISMISS'
        ? { visible: false, dismissedAt: now }
        : { visible: true, reopenedAt: now },
  });
}
