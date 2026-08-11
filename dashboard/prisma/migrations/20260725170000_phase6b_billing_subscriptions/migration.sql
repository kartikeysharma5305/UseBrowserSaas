-- Phase 6B billing and subscriptions.
-- Existing users keep their current planCode. Stripe subscription data starts empty.

CREATE TYPE "PlanSource" AS ENUM ('DEFAULT', 'STRIPE', 'MANUAL', 'INTERNAL');
CREATE TYPE "BillingProvider" AS ENUM ('STRIPE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');
CREATE TYPE "BillingWebhookProcessingState" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "User"
ADD COLUMN "planSource" "PlanSource" NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN "stripeCustomerId" TEXT;

UPDATE "User"
SET "planSource" = CASE
  WHEN "planCode" = 'INTERNAL' THEN 'INTERNAL'::"PlanSource"
  WHEN "planCode" = 'PRO' THEN 'MANUAL'::"PlanSource"
  ELSE 'DEFAULT'::"PlanSource"
END;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
  "stripeSubscriptionId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePriceId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL,
  "planCode" "PlanCode" NOT NULL,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "lastStripeEventCreatedAt" TIMESTAMP(3),
  "lastStripeEventId" TEXT,
  "paymentFailureAt" TIMESTAMP(3),
  "paymentFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "apiVersion" TEXT,
  "stripeCreatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "processingState" "BillingWebhookProcessingState" NOT NULL DEFAULT 'PROCESSING',
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountDeletion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "canceledSubscription" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AccountDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

CREATE INDEX "BillingWebhookEvent_processingState_idx" ON "BillingWebhookEvent"("processingState");
CREATE INDEX "BillingWebhookEvent_stripeCreatedAt_idx" ON "BillingWebhookEvent"("stripeCreatedAt");

CREATE UNIQUE INDEX "AccountDeletion_userId_key" ON "AccountDeletion"("userId");

ALTER TABLE "Subscription"
ADD CONSTRAINT "Subscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountDeletion"
ADD CONSTRAINT "AccountDeletion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
