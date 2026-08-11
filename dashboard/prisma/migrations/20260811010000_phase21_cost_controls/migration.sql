-- Phase 21: immutable execution configuration and cost budget snapshots.
ALTER TABLE "Run"
ADD COLUMN "executionConfiguration" JSONB,
ADD COLUMN "costBudget" JSONB;
