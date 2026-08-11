ALTER TYPE "AgentEventType" ADD VALUE 'RUN_CANCELED';

ALTER TABLE "Run"
ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN "canceledAt" TIMESTAMP(3),
ADD COLUMN "canceledByUserId" TEXT,
ADD COLUMN "cancelReason" TEXT;

CREATE INDEX "Run_status_cancelRequestedAt_idx"
ON "Run"("status", "cancelRequestedAt");
