import Link from 'next/link';
import { BETA_CONFIG } from '@/lib/beta/config';
export default function BetaPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Closed beta</h1>
      <p className="mt-4">
        Access is invitation-only while we validate reliability and support
        capacity. Beta data is governed by the published Terms, Privacy Policy,
        and Acceptable Use Policy.
      </p>
      <p className="mt-4">
        Release {BETA_CONFIG.releaseId}. Need help?{' '}
        <a className="underline" href={`mailto:${BETA_CONFIG.supportEmail}`}>
          {BETA_CONFIG.supportEmail}
        </a>
        .
      </p>
      <div className="mt-6 flex gap-4">
        <Link className="underline" href="/register">
          Redeem invitation
        </Link>
        <Link className="underline" href="/privacy">
          Privacy
        </Link>
        <Link className="underline" href="/terms">
          Terms
        </Link>
      </div>
    </main>
  );
}
