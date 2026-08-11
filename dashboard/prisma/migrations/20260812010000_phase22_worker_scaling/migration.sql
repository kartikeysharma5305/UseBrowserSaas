-- Phase 22: durable, sanitized browser-worker operational health.
CREATE TYPE "WorkerInstanceStatus" AS ENUM ('STARTING', 'ACTIVE', 'DRAINING', 'STOPPED', 'LOST');

CREATE TABLE "WorkerInstance" (
    "id" TEXT NOT NULL,
    "status" "WorkerInstanceStatus" NOT NULL DEFAULT 'STARTING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "concurrency" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL DEFAULT 0,
    "buildVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerInstance_status_lastHeartbeatAt_idx" ON "WorkerInstance"("status", "lastHeartbeatAt");
CREATE INDEX "WorkerInstance_lastHeartbeatAt_idx" ON "WorkerInstance"("lastHeartbeatAt");
