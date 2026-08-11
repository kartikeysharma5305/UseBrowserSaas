import { notFound } from 'next/navigation';
import { BetaOperations } from '@/components/dashboard/beta-operations';
import { requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { getBetaOperationsSnapshot } from '@/lib/beta/operations';
import { BETA_CONFIG } from '@/lib/beta/config';
export default async function InternalBetaPage() {
  const user = await requireAuthenticatedUser();
  if (!user || user.planCode !== 'INTERNAL') notFound();
  const snapshot = await getBetaOperationsSnapshot();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Closed beta operations</h1>
      <p className="mb-6 mt-2 text-sm text-slate-500">
        Release {BETA_CONFIG.releaseId} · capacity {BETA_CONFIG.maxActiveUsers}{' '}
        · invitation tokens are shown once.
      </p>
      <BetaOperations initial={snapshot} />
    </div>
  );
}
