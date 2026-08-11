CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "RunSource" AS ENUM ('MANUAL', 'SCHEDULED', 'API');
ALTER TABLE "Run" ADD COLUMN "source" "RunSource" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[],
  "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiIdempotencyRequest" (
  "id" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
  "runId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiIdempotencyRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiAuditEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");
CREATE INDEX "ApiKey_userId_status_idx" ON "ApiKey"("userId", "status");
CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");
CREATE UNIQUE INDEX "ApiIdempotencyRequest_apiKeyId_operation_idempotencyKeyHash_key" ON "ApiIdempotencyRequest"("apiKeyId", "operation", "idempotencyKeyHash");
CREATE INDEX "ApiIdempotencyRequest_expiresAt_idx" ON "ApiIdempotencyRequest"("expiresAt");
CREATE INDEX "ApiIdempotencyRequest_userId_createdAt_idx" ON "ApiIdempotencyRequest"("userId", "createdAt");
CREATE INDEX "ApiAuditEvent_userId_createdAt_idx" ON "ApiAuditEvent"("userId", "createdAt");
CREATE INDEX "ApiAuditEvent_apiKeyId_createdAt_idx" ON "ApiAuditEvent"("apiKeyId", "createdAt");
CREATE INDEX "ApiAuditEvent_action_createdAt_idx" ON "ApiAuditEvent"("action", "createdAt");

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiIdempotencyRequest" ADD CONSTRAINT "ApiIdempotencyRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiIdempotencyRequest" ADD CONSTRAINT "ApiIdempotencyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiAuditEvent" ADD CONSTRAINT "ApiAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiAuditEvent" ADD CONSTRAINT "ApiAuditEvent_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
