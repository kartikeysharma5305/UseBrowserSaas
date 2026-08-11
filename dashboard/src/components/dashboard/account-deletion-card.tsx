'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type DeletionState = 'idle' | 'submitting' | 'pending' | 'completed' | 'failed';

/** Owner-scoped deletion control. The server never accepts a client-selected user. */
export function AccountDeletionCard() {
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<DeletionState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (state === 'submitting' || confirmation !== 'DELETE') return;
    setState('submitting');
    setMessage(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error();
      if (payload.data?.status === 'COMPLETED') {
        setState('completed');
        setMessage('Your account has been deleted. Signing out…');
        window.location.assign('/api/auth/sign-out');
      } else {
        setState('pending');
        setMessage(
          'Deletion is in progress. You may safely retry this action if it needs to resume.'
        );
      }
    } catch {
      setState('failed');
      setMessage(
        'We could not complete deletion yet. Your request is saved; please try again later.'
      );
    }
  };

  return (
    <Card className="border-red-200 p-6 dark:border-red-900">
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
        Delete account
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        This permanently removes your agents, runs, and private artifacts.
        Limited billing records may be retained for legal and accounting
        obligations. This action cannot be undone.
      </p>
      <label
        className="mt-4 block text-sm font-medium"
        htmlFor="delete-confirmation"
      >
        Type DELETE to confirm
      </label>
      <input
        id="delete-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={state === 'submitting' || state === 'completed'}
        className="mt-2 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm"
        autoComplete="off"
      />
      <Button
        className="mt-4"
        variant="danger"
        disabled={
          confirmation !== 'DELETE' ||
          state === 'submitting' ||
          state === 'completed'
        }
        onClick={() => void submit()}
      >
        {state === 'submitting' ? 'Deleting…' : 'Delete account'}
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
