'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Onboarding = {
  visible: boolean;
  checklist: Record<string, boolean | string | null>;
};

const ITEMS = [
  ['accountReady', 'Account ready'],
  ['firstAgentCreatedAt', 'Create your first Agent'],
  ['firstRunStartedAt', 'Start your first Run'],
  ['firstSuccessfulRunAt', 'Complete a successful Run'],
  ['firstScheduleCreatedAt', 'Optional: create a schedule'],
  ['notificationPreferencesReviewedAt', 'Optional: review notifications'],
] as const;

export function OnboardingCard() {
  const [state, setState] = useState<Onboarding | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/onboarding', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setState((await response.json()).data);
      })
      .catch((loadError) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        )
          return;
        setError(
          'Onboarding is temporarily unavailable. Your dashboard still works normally.'
        );
      });
    return () => controller.abort();
  }, []);
  if (!state && !error)
    return (
      <Card
        aria-label="Loading onboarding"
        className="h-36 animate-pulse bg-slate-100 dark:bg-slate-800"
      >
        <span className="sr-only">Loading onboarding</span>
      </Card>
    );
  if (error) return <p className="text-xs text-slate-500">{error}</p>;
  if (!state?.visible) return null;
  const complete = ITEMS.filter(([key]) =>
    Boolean(state.checklist[key])
  ).length;
  const dismiss = async () => {
    const response = await fetch('/api/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'DISMISS' }),
    });
    if (response.ok) setState((await response.json()).data);
  };
  return (
    <Card className="border-slate-300 p-6 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">
            First-run checklist · {complete}/{ITEMS.length}
          </p>
          <h2 className="text-xl font-semibold">
            Create and run your first Agent
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Templates provide safe defaults while keeping every created Agent in
            the ordinary execution path.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void dismiss()}>
          Skip for now
        </Button>
      </div>
      <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {ITEMS.map(([key, label]) => (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"
          >
            <span aria-hidden="true">{state.checklist[key] ? '✓' : '○'}</span>
            {label}
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/dashboard/templates">
          <Button>Browse templates</Button>
        </Link>
        <Link href="/dashboard/agents/create">
          <Button variant="secondary">Create manually</Button>
        </Link>
        <Link href="/dashboard/feedback">
          <Button variant="ghost">Send beta feedback</Button>
        </Link>
      </div>
    </Card>
  );
}
