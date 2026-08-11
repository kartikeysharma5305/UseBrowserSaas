import { BetaFeedback } from '@/components/dashboard/beta-feedback';
import { BETA_CONFIG } from '@/lib/beta/config';
export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Closed beta feedback</h1>
      <p className="mb-6 mt-2 text-sm text-slate-600 dark:text-slate-400">
        Share a concise issue or idea. Remove secrets and sensitive task
        content. Current release: {BETA_CONFIG.releaseId}.
      </p>
      <BetaFeedback />
    </div>
  );
}
