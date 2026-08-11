import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import type { PlanCode } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { BETA_CONFIG, normalizeBetaEmail } from './config';

const ACCEPTING_TIMEOUT_MS = 10 * 60_000;

export function hashBetaInviteToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateBetaInviteToken() {
  return randomBytes(32).toString('base64url');
}

export async function createBetaInvite(input: {
  email: string;
  planCode: Extract<PlanCode, 'FREE' | 'PRO'>;
  note?: string;
  invitedByUserId?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = normalizeBetaEmail(input.email);
  const token = generateBetaInviteToken();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('closed-beta-capacity', 0))`;
    const [active, pending] = await Promise.all([
      tx.user.count({ where: { betaAccessStatus: 'ACTIVE' } }),
      tx.betaInvite.count({
        where: {
          status: { in: ['PENDING', 'ACCEPTING'] },
          expiresAt: { gt: now },
        },
      }),
    ]);
    if (active + pending >= BETA_CONFIG.maxActiveUsers)
      throw new Error('BETA_CAPACITY_REACHED');
    const invite = await tx.betaInvite.create({
      data: {
        email,
        tokenHash: hashBetaInviteToken(token),
        tokenPrefix: token.slice(0, 8),
        planCode: input.planCode,
        note: input.note?.trim() || null,
        invitedByUserId: input.invitedByUserId ?? null,
        expiresAt: new Date(
          now.getTime() + BETA_CONFIG.inviteLifetimeDays * 86_400_000
        ),
      },
      select: {
        id: true,
        email: true,
        status: true,
        planCode: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { invite, token };
  });
}

export async function reserveBetaInvite(
  token: string,
  emailInput: string,
  now = new Date()
) {
  const tokenHash = hashBetaInviteToken(token);
  const email = normalizeBetaEmail(emailInput);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tokenHash}, 0))`;
    const invite = await tx.betaInvite.findUnique({ where: { tokenHash } });
    const stale =
      invite?.status === 'ACCEPTING' &&
      invite.claimStartedAt &&
      invite.claimStartedAt.getTime() < now.getTime() - ACCEPTING_TIMEOUT_MS;
    if (
      !invite ||
      invite.email !== email ||
      invite.expiresAt <= now ||
      (!stale && invite.status !== 'PENDING')
    )
      throw new Error('BETA_INVITE_INVALID');
    const active = await tx.user.count({
      where: { betaAccessStatus: 'ACTIVE' },
    });
    if (active >= BETA_CONFIG.maxActiveUsers)
      throw new Error('BETA_CAPACITY_REACHED');
    return tx.betaInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTING', claimStartedAt: now },
    });
  });
}

export async function releaseBetaInvite(inviteId: string) {
  await prisma.betaInvite.updateMany({
    where: { id: inviteId, status: 'ACCEPTING', acceptedByUserId: null },
    data: { status: 'PENDING', claimStartedAt: null },
  });
}

export async function acceptBetaInvite(
  inviteId: string,
  userId: string,
  now = new Date()
) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.betaInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.status !== 'ACCEPTING' || invite.expiresAt <= now)
      throw new Error('BETA_INVITE_INVALID');
    await tx.user.update({
      where: { id: userId },
      data: {
        betaAccessStatus: 'ACTIVE',
        betaActivatedAt: now,
        betaEndedAt: null,
        planCode: invite.planCode,
        planSource: 'MANUAL',
        planAssignedAt: now,
      },
    });
    return tx.betaInvite.update({
      where: { id: inviteId },
      data: {
        status: 'ACCEPTED',
        acceptedByUserId: userId,
        acceptedAt: now,
        claimStartedAt: null,
      },
    });
  });
}

export async function revokeBetaInvite(id: string) {
  return prisma.betaInvite.updateMany({
    where: { id, status: { in: ['PENDING', 'ACCEPTING'] } },
    data: { status: 'REVOKED', revokedAt: new Date(), claimStartedAt: null },
  });
}
