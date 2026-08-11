-- CreateEnum
CREATE TYPE "RunArtifactType" AS ENUM ('SCREENSHOT');

-- Add structured event columns without discarding legacy rows.
ALTER TABLE "AgentEvent"
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "data" JSONB;

-- Backfill a deterministic sequence independently for each existing run.
WITH ranked_events AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "runId"
            ORDER BY "timestamp" ASC, "id" ASC
        )::INTEGER AS "backfilledSequence"
    FROM "AgentEvent"
)
UPDATE "AgentEvent" AS event
SET "sequence" = ranked_events."backfilledSequence"
FROM ranked_events
WHERE event."id" = ranked_events."id";

ALTER TABLE "AgentEvent"
ALTER COLUMN "sequence" SET NOT NULL;

-- CreateTable
CREATE TABLE "RunArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" "RunArtifactType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "stepNumber" INTEGER,
    "eventSequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunArtifact_pkey" PRIMARY KEY ("id")
);

-- Replace the single-column event index with deterministic ordering indexes.
DROP INDEX "AgentEvent_runId_idx";
CREATE UNIQUE INDEX "AgentEvent_runId_sequence_key"
ON "AgentEvent"("runId", "sequence");
CREATE INDEX "AgentEvent_runId_sequence_idx"
ON "AgentEvent"("runId", "sequence");

CREATE UNIQUE INDEX "RunArtifact_runId_storageKey_key"
ON "RunArtifact"("runId", "storageKey");
CREATE INDEX "RunArtifact_runId_createdAt_idx"
ON "RunArtifact"("runId", "createdAt");
CREATE INDEX "RunArtifact_runId_stepNumber_idx"
ON "RunArtifact"("runId", "stepNumber");
CREATE INDEX "RunArtifact_runId_eventSequence_idx"
ON "RunArtifact"("runId", "eventSequence");

-- AddForeignKey
ALTER TABLE "RunArtifact"
ADD CONSTRAINT "RunArtifact_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
