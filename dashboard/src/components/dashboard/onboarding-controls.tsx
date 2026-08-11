'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function OnboardingControls() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reopen = async () => {
    if (busy) return;
    setBusy(true);
    const response = await fetch('/api/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'REOPEN' }),
    });
    setMessage(
      response.ok
        ? 'Onboarding reopened on your dashboard.'
        : 'Unable to reopen onboarding. Please try again.'
    );
    setBusy(false);
  };
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">First-run onboarding</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Reopen the authoritative checklist and template guidance at any time.
      </p>
      <Button
        className="mt-4"
        variant="secondary"
        disabled={busy}
        onClick={() => void reopen()}
      >
        {busy ? 'Reopening…' : 'Reopen onboarding'}
      </Button>
      {message ? (
        <p
          role="status"
          className="mt-3 text-sm text-slate-600 dark:text-slate-300"
        >
          {message}
        </p>
      ) : null}
    </Card>
  );
}
