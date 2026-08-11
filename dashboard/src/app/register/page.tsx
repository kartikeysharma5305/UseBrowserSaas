import { RegisterForm } from '@/components/auth/auth-forms';
import { BETA_CONFIG } from '@/lib/beta/config';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const inviteToken = (await searchParams).invite?.slice(0, 256) ?? '';
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Browser Use
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
            Create your account
          </h1>
        </div>
        {BETA_CONFIG.enabled && !inviteToken ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Closed beta registration requires an invitation link.
          </p>
        ) : null}
        <RegisterForm
          betaMode={BETA_CONFIG.enabled}
          inviteToken={inviteToken}
        />
      </div>
    </main>
  );
}
