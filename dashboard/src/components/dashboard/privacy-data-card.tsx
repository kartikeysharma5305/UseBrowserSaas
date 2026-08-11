'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Card } from '@/components/ui/card';

export function PrivacyDataCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/account/export', { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to create data export.');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `browser-use-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      setStatus('Your export was downloaded.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        Privacy and your data
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Download a portable JSON copy of your retained profile, Agents, Runs,
        schedules, usage, and service metadata. Artifact files remain available
        through their owner-protected download links while retained.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={download}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {busy ? 'Preparing…' : 'Download my data'}
      </button>
      {status ? <p className="mt-2 text-sm text-slate-500">{status}</p> : null}
      <p className="mt-4 text-xs text-slate-500">
        Artifact retention: FREE 7 days, PRO 30 days, INTERNAL 90 days. Other
        records follow the documented operational retention policy and legal
        review requirements.
      </p>
      <nav className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
        <Link href="/acceptable-use" className="underline underline-offset-4">
          Acceptable use
        </Link>
        <Link href="/cookies" className="underline underline-offset-4">
          Cookies
        </Link>
      </nav>
    </Card>
  );
}
