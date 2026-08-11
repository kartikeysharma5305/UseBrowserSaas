CREATE TYPE "ScheduleKind" AS ENUM ('ONCE', 'DAILY', 'WEEKLY');
CREATE TYPE "ScheduleState" AS ENUM ('ENABLED', 'PAUSED', 'COMPLETED');
CREATE TYPE "ScheduledOccurrenceStatus" AS ENUM (
  'DISCOVERED',
  'ADMITTED',
  'SKIPPED',
  'QUOTA_BLOCKED',
  'ACTIVE_LIMIT_BLOCKED',
  'PLAN_BLOCKED',
  'ACCOUNT_BLOCKED',
  'AGENT_BLOCKED',
  'MISSED',
  'CANCELED',
  'FAILED'
);

CREATE TABLE "Schedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "kind" "ScheduleKind" NOT NULL,
  "timezone" TEXT NOT NULL,
  "localTime" TEXT,
  "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "oneTimeAt" TIMESTAMP(3),
  "state" "ScheduleState" NOT NULL DEFAULT 'ENABLED',
  "nextRunAt" TIMESTAMP(3),
  "lastTriggeredOccurrenceAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveBlocks" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledOccurrence" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledOccurrenceStatus" NOT NULL DEFAULT 'DISCOVERED',
  "runId" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "processingLeaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Schedule_state_nextRunAt_idx" ON "Schedule"("state", "nextRunAt");
CREATE INDEX "Schedule_userId_state_idx" ON "Schedule"("userId", "state");
CREATE INDEX "Schedule_agentId_state_idx" ON "Schedule"("agentId", "state");
CREATE UNIQUE INDEX "ScheduledOccurrence_runId_key" ON "ScheduledOccurrence"("runId");
CREATE UNIQUE INDEX "ScheduledOccurrence_scheduleId_scheduledFor_key" ON "ScheduledOccurrence"("scheduleId", "scheduledFor");
CREATE INDEX "ScheduledOccurrence_status_nextAttemptAt_idx" ON "ScheduledOccurrence"("status", "nextAttemptAt");
CREATE INDEX "ScheduledOccurrence_scheduleId_scheduledFor_idx" ON "ScheduledOccurrence"("scheduleId", "scheduledFor");

ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledOccurrence" ADD CONSTRAINT "ScheduledOccurrence_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledOccurrence" ADD CONSTRAINT "ScheduledOccurrence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
