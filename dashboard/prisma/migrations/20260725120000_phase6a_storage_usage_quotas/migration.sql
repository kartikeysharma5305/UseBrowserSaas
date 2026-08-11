CREATE TYPE "ArtifactStorageProvider" AS ENUM ('LOCAL', 'S3');
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'PRO', 'INTERNAL');
CREATE TYPE "UsageType" AS ENUM (
  'RUN_ADMITTED',
  'RUN_SUCCEEDED',
  'RUN_FAILED',
  'RUN_TIMED_OUT',
  'RUN_CANCELED',
  'ATTEMPT_STARTED',
  'EXECUTION_MILLISECOND',
  'BROWSER_STEP',
  'ARTIFACT_BYTE',
  'LLM_INPUT_TOKEN',
  'LLM_OUTPUT_TOKEN',
  'LLM_TOTAL_TOKEN'
);
CREATE TYPE "UsageUnit" AS ENUM ('COUNT', 'MILLISECOND', 'BYTE');
CREATE TYPE "UsageMeasurement" AS ENUM ('EXACT', 'DERIVED', 'PROVIDER_REPORTED');

ALTER TABLE "User"
ADD COLUMN "planCode" "PlanCode" NOT NULL DEFAULT 'FREE',
ADD COLUMN "planAssignedAt" TIMESTAMP(3);

ALTER TABLE "RunArtifact"
ADD COLUMN "storageProvider" "ArtifactStorageProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "checksum" TEXT;

CREATE TABLE "UsageRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT,
  "attempt" INTEGER,
  "type" "UsageType" NOT NULL,
  "quantity" BIGINT NOT NULL,
  "unit" "UsageUnit" NOT NULL,
  "measurement" "UsageMeasurement" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageRecord_idempotencyKey_key"
ON "UsageRecord"("idempotencyKey");
CREATE INDEX "UsageRecord_userId_periodStart_type_idx"
ON "UsageRecord"("userId", "periodStart", "type");
CREATE INDEX "UsageRecord_runId_idx" ON "UsageRecord"("runId");
CREATE INDEX "UsageRecord_recordedAt_idx" ON "UsageRecord"("recordedAt");
CREATE INDEX "RunArtifact_storageProvider_createdAt_idx"
ON "RunArtifact"("storageProvider", "createdAt");

ALTER TABLE "UsageRecord"
ADD CONSTRAINT "UsageRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsageRecord"
ADD CONSTRAINT "UsageRecord_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
