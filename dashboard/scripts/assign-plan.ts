import { PlanCode } from '@prisma/client';

import { prisma } from '../src/lib/db/prisma';
import { getPlan } from '../src/lib/plans/catalogue';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const email = args
  .find((value) => value.startsWith('--email='))
  ?.slice('--email='.length)
  .trim()
  .toLowerCase();
const rawPlan = args
  .find((value) => value.startsWith('--plan='))
  ?.slice('--plan='.length)
  .trim()
  .toUpperCase();
const reason = args
  .find((value) => value.startsWith('--reason='))
  ?.slice('--reason='.length)
  .trim()
  .slice(0, 120);
if (!email) throw new Error('--email is required.');
if (!rawPlan || !Object.values(PlanCode).includes(rawPlan as PlanCode)) {
  throw new Error('--plan must be FREE, PRO, or INTERNAL.');
}
const planCode = rawPlan as PlanCode;
getPlan(planCode);
const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, planCode: true },
});
if (!user) throw new Error('User not found.');
if (apply) {
  await prisma.user.update({
    where: { id: user.id },
    data: { planCode, planAssignedAt: new Date() },
  });
}
console.log(
  JSON.stringify({
    dryRun: !apply,
    userId: user.id,
    previousPlan: user.planCode,
    plan: planCode,
    reason: reason || null,
  })
);
await prisma.$disconnect();
