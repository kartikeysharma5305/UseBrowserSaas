CREATE TABLE "OnboardingState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "dismissedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "selectedTemplateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingState_userId_key" ON "OnboardingState"("userId");
CREATE INDEX "OnboardingState_visible_updatedAt_idx" ON "OnboardingState"("visible", "updatedAt");
ALTER TABLE "OnboardingState" ADD CONSTRAINT "OnboardingState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
