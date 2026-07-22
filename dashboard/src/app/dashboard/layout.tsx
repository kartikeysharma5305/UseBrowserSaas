import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getCurrentUser, requireAuth } from '@/lib/auth/helpers';

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAuth();
  const user = await getCurrentUser();

  return <DashboardShell user={user ?? {}}>{children}</DashboardShell>;
}
