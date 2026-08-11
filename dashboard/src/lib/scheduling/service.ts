import type { Prisma, Schedule, ScheduleKind } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { PrismaAgentExecutionService } from '@/lib/execution/prisma-agent-execution-service';
import { getSchedulingEntitlement } from './entitlement';
import { nextOccurrenceAfter, type RecurrenceDefinition } from './recurrence';
import { SCHEDULER_POLICY } from './policy';
import {
  resolveAgentInput,
  VariableResolutionError,
} from '@/lib/variables/resolver';

export type SchedulingErrorCode =
  | 'SCHEDULE_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'SCHEDULING_NOT_AVAILABLE'
  | 'SCHEDULE_LIMIT_REACHED'
  | 'ACCOUNT_DELETION_IN_PROGRESS'
  | 'INVALID_SCHEDULE'
  | 'SCHEDULE_CONFIGURATION_INVALID'
  | 'SCHEDULE_VERSION_CONFLICT';

const DEFINITIONS: Record<
  SchedulingErrorCode,
  { status: number; message: string }
> = {
  SCHEDULE_NOT_FOUND: { status: 404, message: 'Schedule not found.' },
  AGENT_NOT_FOUND: { status: 404, message: 'Agent not found.' },
  SCHEDULING_NOT_AVAILABLE: {
    status: 403,
    message: 'Scheduling is unavailable for this plan.',
  },
  SCHEDULE_LIMIT_REACHED: {
    status: 429,
    message: 'The active schedule limit has been reached.',
  },
  ACCOUNT_DELETION_IN_PROGRESS: {
    status: 403,
    message: 'Account deletion is in progress.',
  },
  INVALID_SCHEDULE: {
    status: 400,
    message: 'The schedule definition is invalid.',
  },
  SCHEDULE_CONFIGURATION_INVALID: {
    status: 409,
    message: 'Update this Schedule’s variable values before resuming.',
  },
  SCHEDULE_VERSION_CONFLICT: {
    status: 409,
    message: 'The schedule changed. Refresh and try again.',
  },
};

export class SchedulingError extends Error {
  readonly status: number;
  constructor(readonly code: SchedulingErrorCode) {
    super(DEFINITIONS[code].message);
    this.name = 'SchedulingError';
    this.status = DEFINITIONS[code].status;
  }
}

export type ScheduleInput = {
  agentId: string;
  kind: ScheduleKind;
  timezone: string;
  localTime?: string | null;
  weekdays?: number[];
  oneTimeAt?: Date | null;
  variables?: Record<string, string | number | boolean>;
};

const PUBLIC_SCHEDULE_SELECT = {
  id: true,
  agentId: true,
  kind: true,
  timezone: true,
  localTime: true,
  weekdays: true,
  oneTimeAt: true,
  state: true,
  nextRunAt: true,
  lastTriggeredOccurrenceAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  variableValues: true,
  variableVersion: true,
  configurationErrorCode: true,
  agent: { select: { id: true, name: true } },
  occurrences: {
    take: 1,
    orderBy: [{ scheduledFor: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      scheduledFor: true,
      status: true,
      runId: true,
      discoveredAt: true,
      resolvedAt: true,
      errorCode: true,
    },
  },
} satisfies Prisma.ScheduleSelect;

function definition(
  input: Omit<ScheduleInput, 'agentId'>
): RecurrenceDefinition {
  const weekdays = [...new Set(input.weekdays ?? [])].sort((a, b) => a - b);
  if (input.kind === 'ONCE') {
    if (!input.oneTimeAt) throw new SchedulingError('INVALID_SCHEDULE');
    return {
      kind: input.kind,
      timezone: input.timezone,
      oneTimeAt: input.oneTimeAt,
    };
  }
  if (!input.localTime || (input.kind === 'WEEKLY' && !weekdays.length))
    throw new SchedulingError('INVALID_SCHEDULE');
  return {
    kind: input.kind,
    timezone: input.timezone,
    localTime: input.localTime,
    weekdays,
  };
}

function scheduleDefinition(
  schedule: Pick<
    Schedule,
    'kind' | 'timezone' | 'localTime' | 'weekdays' | 'oneTimeAt'
  >
) {
  return definition(schedule);
}

async function lock(transaction: Prisma.TransactionClient, key: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function assertEligible(
  transaction: Prisma.TransactionClient,
  userId: string,
  excludeScheduleId?: string
) {
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { planCode: true, accountDeletion: { select: { status: true } } },
  });
  if (
    !user ||
    user.accountDeletion?.status === 'PENDING' ||
    user.accountDeletion?.status === 'FAILED'
  )
    throw new SchedulingError('ACCOUNT_DELETION_IN_PROGRESS');
  const entitlement = getSchedulingEntitlement(user.planCode);
  if (!entitlement.enabled)
    throw new SchedulingError('SCHEDULING_NOT_AVAILABLE');
  const active = await transaction.schedule.count({
    where: {
      userId,
      state: 'ENABLED',
      ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
    },
  });
  if (active >= entitlement.maxActiveSchedules)
    throw new SchedulingError('SCHEDULE_LIMIT_REACHED');
}

export async function listSchedules(userId: string) {
  return prisma.schedule.findMany({
    where: { userId },
    orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'desc' }],
    select: PUBLIC_SCHEDULE_SELECT,
  });
}

export async function getSchedule(userId: string, id: string) {
  const item = await prisma.schedule.findFirst({
    where: { id, userId },
    select: PUBLIC_SCHEDULE_SELECT,
  });
  if (!item) throw new SchedulingError('SCHEDULE_NOT_FOUND');
  return item;
}

export async function createSchedule(
  userId: string,
  input: ScheduleInput,
  now = new Date()
) {
  const recurrence = definition(input);
  if (
    input.kind === 'ONCE' &&
    (!input.oneTimeAt ||
      input.oneTimeAt <= now ||
      input.oneTimeAt.getTime() >
        now.getTime() + SCHEDULER_POLICY.maxFutureYears * 366 * 86_400_000)
  )
    throw new SchedulingError('INVALID_SCHEDULE');
  const nextRunAt = nextOccurrenceAfter(recurrence, now);
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule-user:${userId}`);
    await assertEligible(transaction, userId);
    const agent = await transaction.agent.findFirst({
      where: { id: input.agentId, userId },
      include: { variables: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!agent) throw new SchedulingError('AGENT_NOT_FOUND');
    let resolved;
    try {
      resolved = resolveAgentInput({
        goal: agent.goal,
        targetWebsite: agent.targetWebsite,
        definitions: agent.variables,
        supplied: input.variables ?? {},
        definitionVersion: agent.variableVersion,
      });
    } catch (error) {
      if (error instanceof VariableResolutionError)
        throw new SchedulingError('INVALID_SCHEDULE');
      throw error;
    }
    const variableValues = Object.fromEntries(
      resolved.snapshot.values.map((value) => [value.key, value.value])
    );
    return transaction.schedule.create({
      data: {
        userId,
        agentId: input.agentId,
        kind: input.kind,
        timezone: input.timezone,
        localTime: input.kind === 'ONCE' ? null : input.localTime!,
        weekdays: input.kind === 'WEEKLY' ? (recurrence.weekdays ?? []) : [],
        oneTimeAt: input.kind === 'ONCE' ? input.oneTimeAt : null,
        nextRunAt,
        variableValues,
        variableVersion: agent.variableVersion,
      },
      select: PUBLIC_SCHEDULE_SELECT,
    });
  });
}

export async function updateSchedule(
  userId: string,
  id: string,
  changes: Partial<Omit<ScheduleInput, 'agentId'>> & { version?: number },
  now = new Date()
) {
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule:${id}`);
    const existing = await transaction.schedule.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new SchedulingError('SCHEDULE_NOT_FOUND');
    if (changes.version && changes.version !== existing.version)
      throw new SchedulingError('SCHEDULE_VERSION_CONFLICT');
    const merged = {
      kind: changes.kind ?? existing.kind,
      timezone: changes.timezone ?? existing.timezone,
      localTime:
        changes.localTime !== undefined
          ? changes.localTime
          : existing.localTime,
      weekdays: changes.weekdays ?? existing.weekdays,
      oneTimeAt:
        changes.oneTimeAt !== undefined
          ? changes.oneTimeAt
          : existing.oneTimeAt,
    };
    const recurrence = definition(merged);
    if (
      merged.kind === 'ONCE' &&
      (!merged.oneTimeAt || merged.oneTimeAt <= now)
    )
      throw new SchedulingError('INVALID_SCHEDULE');
    const nextRunAt = nextOccurrenceAfter(recurrence, now);
    const agent = await transaction.agent.findUnique({
      where: { id: existing.agentId },
      include: { variables: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!agent) throw new SchedulingError('AGENT_NOT_FOUND');
    let resolved;
    try {
      resolved = resolveAgentInput({
        goal: agent.goal,
        targetWebsite: agent.targetWebsite,
        definitions: agent.variables,
        supplied:
          changes.variables ??
          (existing.variableValues as Record<
            string,
            string | number | boolean
          >),
        definitionVersion: agent.variableVersion,
      });
    } catch (error) {
      if (error instanceof VariableResolutionError)
        throw new SchedulingError('INVALID_SCHEDULE');
      throw error;
    }
    const variableValues = Object.fromEntries(
      resolved.snapshot.values.map((value) => [value.key, value.value])
    );
    return transaction.schedule.update({
      where: { id },
      data: {
        kind: merged.kind,
        timezone: merged.timezone,
        localTime: merged.kind === 'ONCE' ? null : merged.localTime,
        weekdays: merged.kind === 'WEEKLY' ? (recurrence.weekdays ?? []) : [],
        oneTimeAt: merged.kind === 'ONCE' ? merged.oneTimeAt : null,
        nextRunAt,
        version: { increment: 1 },
        consecutiveFailures: 0,
        variableValues,
        variableVersion: agent.variableVersion,
        configurationErrorCode: null,
        ...(existing.state === 'COMPLETED' ? { state: 'PAUSED' } : {}),
      },
      select: PUBLIC_SCHEDULE_SELECT,
    });
  });
}

export async function pauseSchedule(userId: string, id: string) {
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule:${id}`);
    const existing = await transaction.schedule.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new SchedulingError('SCHEDULE_NOT_FOUND');
    return transaction.schedule.update({
      where: { id },
      data: { state: 'PAUSED', version: { increment: 1 } },
      select: PUBLIC_SCHEDULE_SELECT,
    });
  });
}

export async function resumeSchedule(
  userId: string,
  id: string,
  now = new Date()
) {
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule-user:${userId}`);
    await lock(transaction, `schedule:${id}`);
    const existing = await transaction.schedule.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new SchedulingError('SCHEDULE_NOT_FOUND');
    if (existing.configurationErrorCode)
      throw new SchedulingError('SCHEDULE_CONFIGURATION_INVALID');
    await assertEligible(transaction, userId, id);
    const nextRunAt =
      existing.kind === 'ONCE' &&
      existing.oneTimeAt &&
      existing.oneTimeAt.getTime() >=
        now.getTime() - SCHEDULER_POLICY.oneTimeGraceMs
        ? existing.oneTimeAt
        : nextOccurrenceAfter(scheduleDefinition(existing), now);
    if (!nextRunAt) throw new SchedulingError('INVALID_SCHEDULE');
    return transaction.schedule.update({
      where: { id },
      data: {
        state: 'ENABLED',
        nextRunAt,
        version: { increment: 1 },
        consecutiveFailures: 0,
      },
      select: PUBLIC_SCHEDULE_SELECT,
    });
  });
}

export async function skipNextOccurrence(userId: string, id: string) {
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule:${id}`);
    const existing = await transaction.schedule.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new SchedulingError('SCHEDULE_NOT_FOUND');
    if (existing.state !== 'ENABLED' || !existing.nextRunAt)
      throw new SchedulingError('INVALID_SCHEDULE');
    await transaction.scheduledOccurrence.upsert({
      where: {
        scheduleId_scheduledFor: {
          scheduleId: id,
          scheduledFor: existing.nextRunAt,
        },
      },
      create: {
        scheduleId: id,
        scheduledFor: existing.nextRunAt,
        status: 'SKIPPED',
        resolvedAt: new Date(),
      },
      update: {},
    });
    const nextRunAt = nextOccurrenceAfter(
      scheduleDefinition(existing),
      existing.nextRunAt
    );
    return transaction.schedule.update({
      where: { id },
      data: {
        nextRunAt,
        state: nextRunAt ? existing.state : 'COMPLETED',
        version: { increment: 1 },
      },
      select: PUBLIC_SCHEDULE_SELECT,
    });
  });
}

export async function deleteSchedule(userId: string, id: string) {
  return prisma.$transaction(async (transaction) => {
    await lock(transaction, `schedule:${id}`);
    const existing = await transaction.schedule.findFirst({
      where: { id, userId },
      select: { id: true, agentId: true },
    });
    if (!existing) throw new SchedulingError('SCHEDULE_NOT_FOUND');
    await lock(transaction, `agent:${existing.agentId}`);
    await transaction.schedule.delete({ where: { id } });
    return { deleted: true, id };
  });
}

export async function runScheduleNow(userId: string, id: string) {
  const schedule = await getSchedule(userId, id);
  return new PrismaAgentExecutionService().runAgent({
    agentId: schedule.agentId,
    userId,
    variables: schedule.variableValues as Record<
      string,
      string | number | boolean
    >,
  });
}

export async function listOccurrences(
  userId: string,
  scheduleId: string,
  input: { limit: number; cursor?: string }
) {
  await getSchedule(userId, scheduleId);
  return prisma.scheduledOccurrence.findMany({
    where: { scheduleId },
    take: input.limit,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      scheduledFor: true,
      status: true,
      runId: true,
      discoveredAt: true,
      resolvedAt: true,
      errorCode: true,
    },
  });
}
