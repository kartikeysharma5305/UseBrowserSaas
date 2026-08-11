ALTER TYPE "RunStatus" ADD VALUE 'TIMED_OUT';

CREATE UNIQUE INDEX "Run_one_active_per_agent_idx"
ON "Run" ("agentId")
WHERE "status" IN ('QUEUED', 'RUNNING');
