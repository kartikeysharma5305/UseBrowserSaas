import 'server-only';

import type { BetaFeedbackCategory, BetaFeedbackStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { BETA_CONFIG } from './config';

const SECRET_MARKER =
  /(sk_(live|test)_|whsec_|-----BEGIN [A-Z ]+PRIVATE KEY-----|bearer\s+[a-z0-9._~-]{16,}|password\s*[:=])/i;

export function safeFeedbackText(value: string) {
  const text = value.trim();
  if (!text || SECRET_MARKER.test(text))
    throw new Error('FEEDBACK_CONTAINS_SECRET');
  return text;
}

export async function createBetaFeedback(input: {
  userId: string;
  category: BetaFeedbackCategory;
  message: string;
  contextPath?: string;
  runId?: string;
}) {
  if (input.runId) {
    const owned = await prisma.run.count({
      where: { id: input.runId, agent: { userId: input.userId } },
    });
    if (!owned) throw new Error('RUN_NOT_FOUND');
  }
  return prisma.betaFeedback.create({
    data: {
      userId: input.userId,
      category: input.category,
      message: safeFeedbackText(input.message),
      contextPath: input.contextPath?.trim() || null,
      runId: input.runId || null,
      releaseVersion: BETA_CONFIG.releaseId,
    },
  });
}

export async function updateBetaFeedbackStatus(
  id: string,
  status: BetaFeedbackStatus
) {
  return prisma.betaFeedback.update({ where: { id }, data: { status } });
}
