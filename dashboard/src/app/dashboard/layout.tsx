import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getCurrentUser } from '@/lib/auth/helpers';
import { prisma } from '@/lib/db/prisma';
import { BETA_CONFIG } from '@/lib/beta/config';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await import('@/lib/auth/helpers').then((m) => m.requireAuth());
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Unauthenticated');
  }
  const localUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { betaAccessStatus: true },
  });

  return (
    <DashboardShell
      user={user}
      beta={
        BETA_CONFIG.enabled
          ? {
              status: localUser?.betaAccessStatus ?? 'NONE',
              releaseId: BETA_CONFIG.releaseId,
              supportEmail: BETA_CONFIG.supportEmail,
            }
          : null
      }
    >
      {children}
    </DashboardShell>
  );
}
