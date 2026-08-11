'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type BillingStatus = {
  billingEnabled: boolean;
  planCode: 'FREE' | 'PRO' | 'INTERNAL';
  planSource: string;
  subscription: null | {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  actions: { canStartCheckout: boolean; canOpenPortal: boolean };
};

export function BillingDashboard() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const load = async () => {
    try {
      const r = await fetch('/api/billing/status');
      if (!r.ok) throw new Error('Unable to load billing status.');
      setStatus((await r.json()).data);
      setError(null);
    } catch {
      setError('Unable to load billing status. Please try again.');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (
      !status ||
      new URLSearchParams(window.location.search).get('checkout') !==
        'success' ||
      status.planCode === 'PRO'
    )
      return;
    const id = window.setInterval(() => void load(), 2000);
    const stop = window.setTimeout(() => window.clearInterval(id), 30_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [status?.planCode]);
  const launch = async (kind: 'checkout' | 'portal') => {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch(`/api/billing/${kind}`, {
        method: 'POST',
        headers:
          kind === 'checkout'
            ? { 'content-type': 'application/json' }
            : undefined,
        body: kind === 'checkout' ? JSON.stringify({ plan: 'PRO' }) : undefined,
      });
      const body = await r.json();
      if (
        !r.ok ||
        typeof body.data?.url !== 'string' ||
        !body.data.url.startsWith('https://')
      )
        throw new Error();
      window.location.assign(body.data.url);
    } catch {
      setError('Unable to start billing. Please try again.');
      setBusy(null);
    }
  };
  if (!status && !error)
    return (
      <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
    );
  if (!status)
    return (
      <Card className="p-5 text-sm text-red-700 dark:text-red-300">
        {error}
      </Card>
    );
  const end = status.subscription?.currentPeriodEnd
    ? new Date(status.subscription.currentPeriodEnd).toLocaleDateString()
    : null;
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <p className="text-sm text-slate-500">Current plan</p>
        <p className="mt-1 text-3xl font-semibold">{status.planCode}</p>
        <p className="mt-2 text-sm text-slate-500">
          {status.subscription
            ? `Subscription status: ${status.subscription.status}`
            : 'No active subscription'}
        </p>
        {status.subscription?.cancelAtPeriodEnd && end ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            Access remains active until {end}.
          </p>
        ) : null}
        {status.subscription?.status === 'PAST_DUE' ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            Your payment needs attention.
          </p>
        ) : null}
      </Card>
      {!status.billingEnabled ? (
        <Card className="p-5 text-sm text-slate-600 dark:text-slate-300">
          Billing is unavailable in this environment.
        </Card>
      ) : null}
      {new URLSearchParams(
        typeof window === 'undefined' ? '' : window.location.search
      ).get('checkout') === 'success' && status.planCode !== 'PRO' ? (
        <Card className="p-5 text-sm">
          Waiting for payment confirmation. Your plan changes only after a
          verified webhook.
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {status.actions.canStartCheckout ? (
          <Button
            disabled={busy !== null}
            onClick={() => void launch('checkout')}
          >
            {busy === 'checkout' ? 'Opening Checkout…' : 'Start PRO'}
          </Button>
        ) : null}
        {status.actions.canOpenPortal ? (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void launch('portal')}
          >
            {busy === 'portal' ? 'Opening Portal…' : 'Manage Billing'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
        <Link
          className="text-sm font-medium text-slate-600 underline dark:text-slate-300"
          href="/dashboard/usage"
        >
          View usage
        </Link>
      </div>
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
