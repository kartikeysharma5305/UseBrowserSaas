-- Durable, resumable progress for the Phase 6B account-deletion workflow.
CREATE TYPE "AccountDeletionStage" AS ENUM ('REQUESTED', 'CANCELING_RUNS', 'DELETING_ARTIFACTS', 'CANCELING_SUBSCRIPTION', 'DELETING_PRODUCT_DATA', 'INVALIDATING_SESSIONS', 'COMPLETED');

ALTER TABLE "AccountDeletion"
  ADD COLUMN "stage" "AccountDeletionStage" NOT NULL DEFAULT 'REQUESTED',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT;
