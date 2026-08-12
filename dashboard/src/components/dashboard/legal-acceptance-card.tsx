'use client';

import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';

type LegalStatus = {
  requiresAcceptance: boolean;
  current: Record<'TERMS' | 'PRIVACY' | 'ACCEPTABLE_USE', boolean>;
};

export function LegalAcceptanceCard() {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/legal/acceptance', {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Unable to load legal acknowledgement.');
    const payload = (await response.json()) as { data: LegalStatus };
    setStatus(payload.data);
  }

  useEffect(() => {
    void load().catch(() =>
      setMessage('Unable to load legal acknowledgement.')
    );
  }, []);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/legal/acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: ['TERMS', 'PRIVACY', 'ACCEPTABLE_USE'],
        }),
      });
      if (!response.ok) throw new Error('Legal acknowledgement was not saved.');
      const payload = (await response.json()) as { data: LegalStatus };
      setStatus(payload.data);
      setMessage('Your current legal acknowledgement is recorded.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Legal acknowledgement was not saved.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        Legal acknowledgement
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Current Terms, Privacy Policy, and Acceptable Use Policy:{' '}
        {status?.requiresAcceptance === false
          ? 'acknowledged'
          : 'action required'}
        .
      </p>
      {status?.requiresAcceptance ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void accept()}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {busy ? 'Saving…' : 'Acknowledge current policies'}
        </button>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-slate-500">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
