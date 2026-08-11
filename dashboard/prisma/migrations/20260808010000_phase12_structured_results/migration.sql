-- Phase 12: immutable structured-output definitions and validated Run results.
CREATE TYPE "StructuredResultStatus" AS ENUM (
  'NOT_REQUESTED', 'PENDING', 'VALID', 'PARTIAL', 'INVALID',
  'PARSE_FAILED', 'TOO_LARGE'
);

ALTER TABLE "Agent" ADD COLUMN "outputSchema" JSONB;

ALTER TABLE "Run"
  ADD COLUMN "outputSchemaSnapshot" JSONB,
  ADD COLUMN "outputSchemaVersion" INTEGER,
  ADD COLUMN "structuredRawResult" TEXT,
  ADD COLUMN "structuredCandidate" JSONB,
  ADD COLUMN "structuredResult" JSONB,
  ADD COLUMN "structuredStatus" "StructuredResultStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "structuredErrors" JSONB,
  ADD COLUMN "structuredValidatedAt" TIMESTAMP(3);

CREATE INDEX "Run_structuredStatus_idx" ON "Run"("structuredStatus");
