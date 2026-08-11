import { prisma } from '../src/lib/db/prisma';
import { deleteSchedule, updateSchedule } from '../src/lib/scheduling/service';

const user = await prisma.user.findFirstOrThrow({
  where: { name: 'Phase 6C Runtime' },
  orderBy: { createdAt: 'desc' },
});
const schedule = await prisma.schedule.findFirstOrThrow({
  where: { userId: user.id, kind: 'DAILY' },
  orderBy: { createdAt: 'desc' },
});
const historyBefore = await prisma.scheduledOccurrence.findMany({
  where: { scheduleId: schedule.id },
  select: { id: true, status: true, scheduledFor: true },
});
const updated = await updateSchedule(
  user.id,
  schedule.id,
  { localTime: '23:47', version: schedule.version },
  new Date()
);
const historyAfter = await prisma.scheduledOccurrence.findMany({
  where: { scheduleId: schedule.id },
  select: { id: true, status: true, scheduledFor: true },
});
const admittedRun = await prisma.run.findFirst({
  where: { agentId: schedule.agentId },
  orderBy: { createdAt: 'desc' },
  select: { id: true },
});
await deleteSchedule(user.id, schedule.id);
console.log(
  JSON.stringify({
    editAdvancedVersion: updated.version === schedule.version + 1,
    editRecomputedFuture: Boolean(
      updated.nextRunAt && updated.nextRunAt > new Date()
    ),
    historyImmutable:
      JSON.stringify(historyAfter) === JSON.stringify(historyBefore),
    deleteRemovedFutureSchedule:
      (await prisma.schedule.count({ where: { id: schedule.id } })) === 0,
    deletePreservedExistingRun:
      !admittedRun ||
      (await prisma.run.count({ where: { id: admittedRun.id } })) === 1,
  })
);
await prisma.$disconnect();
