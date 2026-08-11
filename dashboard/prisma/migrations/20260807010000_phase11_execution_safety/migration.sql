-- Phase 11: durable Agent execution-safety configuration and immutable Run policy snapshots.
ALTER TABLE "Agent" ADD COLUMN "safetyPolicy" JSONB;
ALTER TABLE "Run" ADD COLUMN "executionSafetyPolicy" JSONB;
