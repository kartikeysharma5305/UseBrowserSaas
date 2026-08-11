ALTER TABLE "Run"
ADD COLUMN "queueJobId" TEXT,
ADD COLUMN "queuedAt" TIMESTAMP(3),
ADD COLUMN "workerId" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastFailureCode" TEXT;

CREATE UNIQUE INDEX "Run_queueJobId_key" ON "Run"("queueJobId");
CREATE INDEX "Run_status_leaseExpiresAt_idx" ON "Run"("status", "leaseExpiresAt");
CREATE INDEX "Run_workerId_status_idx" ON "Run"("workerId", "status");
CREATE INDEX "Run_queuedAt_idx" ON "Run"("queuedAt");
