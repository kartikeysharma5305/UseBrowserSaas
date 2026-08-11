CREATE TYPE "BetaAccessStatus" AS ENUM ('NONE', 'ACTIVE', 'SUSPENDED', 'ENDED');
CREATE TYPE "BetaInviteStatus" AS ENUM ('PENDING', 'ACCEPTING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "BetaFeedbackCategory" AS ENUM ('BUG', 'USABILITY', 'FEATURE_REQUEST', 'RUN_FAILURE', 'PERFORMANCE', 'BILLING', 'OTHER');
CREATE TYPE "BetaFeedbackStatus" AS ENUM ('NEW', 'REVIEWING', 'RESOLVED', 'WONT_FIX');

ALTER TABLE "User"
  ADD COLUMN "betaAccessStatus" "BetaAccessStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "betaActivatedAt" TIMESTAMP(3),
  ADD COLUMN "betaEndedAt" TIMESTAMP(3);

CREATE TABLE "BetaInvite" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "status" "BetaInviteStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "planCode" "PlanCode" NOT NULL DEFAULT 'FREE',
  "invitedByUserId" TEXT,
  "acceptedByUserId" TEXT,
  "claimStartedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BetaInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT,
  "category" "BetaFeedbackCategory" NOT NULL,
  "message" TEXT NOT NULL,
  "contextPath" TEXT,
  "status" "BetaFeedbackStatus" NOT NULL DEFAULT 'NEW',
  "releaseVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BetaInvite_tokenHash_key" ON "BetaInvite"("tokenHash");
CREATE UNIQUE INDEX "BetaInvite_acceptedByUserId_key" ON "BetaInvite"("acceptedByUserId");
CREATE INDEX "BetaInvite_email_status_idx" ON "BetaInvite"("email", "status");
CREATE INDEX "BetaInvite_status_expiresAt_idx" ON "BetaInvite"("status", "expiresAt");
CREATE INDEX "BetaInvite_invitedByUserId_createdAt_idx" ON "BetaInvite"("invitedByUserId", "createdAt");
CREATE INDEX "BetaFeedback_userId_createdAt_idx" ON "BetaFeedback"("userId", "createdAt");
CREATE INDEX "BetaFeedback_status_createdAt_idx" ON "BetaFeedback"("status", "createdAt");
CREATE INDEX "BetaFeedback_runId_idx" ON "BetaFeedback"("runId");
CREATE INDEX "User_betaAccessStatus_idx" ON "User"("betaAccessStatus");

ALTER TABLE "BetaInvite" ADD CONSTRAINT "BetaInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BetaInvite" ADD CONSTRAINT "BetaInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
