import type { PlanCode } from '@prisma/client';

import { getPlan } from '@/lib/plans/catalogue';

export function getSchedulingEntitlement(planCode: PlanCode) {
  const limits = getPlan(planCode).limits;
  return {
    enabled: limits.schedulingEnabled,
    maxActiveSchedules: limits.maxActiveSchedules,
  };
}
