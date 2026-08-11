import { RunStatus, type Prisma } from '@prisma/client';

import { ExecutionServiceError } from '@/lib/execution/errors';
import { isExecutionAdmissionEnabled, SECURITY_POLICY } from './policy';

export async function enforceRunAdmissionSecurity(
  transaction: Prisma.TransactionClient,
  input: { userId: string; agentId: string; now: Date }
) {
  if (!isExecutionAdmissionEnabled())
    throw new ExecutionServiceError('EXECUTION_DISABLED', {
      stage: 'queue_reserve',
    });

  const since = new Date(
    input.now.getTime() - SECURITY_POLICY.runAdmission.windowMs
  );
  const [queued, userBurst, agentBurst] = await Promise.all([
    transaction.run.count({
      where: { agent: { userId: input.userId }, status: RunStatus.QUEUED },
    }),
    transaction.run.count({
      where: { agent: { userId: input.userId }, createdAt: { gte: since } },
    }),
    transaction.run.count({
      where: { agentId: input.agentId, createdAt: { gte: since } },
    }),
  ]);
  if (queued >= SECURITY_POLICY.runAdmission.queuedRunsPerUser)
    throw new ExecutionServiceError('USER_QUEUE_LIMIT_REACHED', {
      stage: 'queue_reserve',
    });
  if (
    userBurst >= SECURITY_POLICY.runAdmission.userRunsPerMinute ||
    agentBurst >= SECURITY_POLICY.runAdmission.agentRunsPerMinute
  )
    throw new ExecutionServiceError('RUN_RATE_LIMITED', {
      stage: 'queue_reserve',
    });
}
