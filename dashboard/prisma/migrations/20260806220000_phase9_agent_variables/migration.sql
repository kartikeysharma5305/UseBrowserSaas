-- Phase 9: durable Agent variables and immutable Run/Schedule input snapshots.
CREATE TYPE "AgentVariableType" AS ENUM ('TEXT', 'URL', 'NUMBER', 'BOOLEAN', 'SECRET');

ALTER TABLE "Agent" ADD COLUMN "variableVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Run"
  ADD COLUMN "inputSnapshot" JSONB,
  ADD COLUMN "executionTask" TEXT,
  ADD COLUMN "executionTargetWebsite" TEXT;
ALTER TABLE "Schedule"
  ADD COLUMN "variableValues" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "variableVersion" INTEGER,
  ADD COLUMN "configurationErrorCode" TEXT;

CREATE TABLE "AgentVariable" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "type" "AgentVariableType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "defaultValue" TEXT,
  "constraints" JSONB,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentVariable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentVariable_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentVariable_agentId_key_key" ON "AgentVariable"("agentId", "key");
CREATE INDEX "AgentVariable_agentId_displayOrder_idx" ON "AgentVariable"("agentId", "displayOrder");
