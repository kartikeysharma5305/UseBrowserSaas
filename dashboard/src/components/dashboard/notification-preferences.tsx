'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Preferences = {
  emailEnabled: boolean;
  runSuccess: boolean;
  runFailure: boolean;
  runCanceled: boolean;
  scheduledAlerts: boolean;
  billingAlerts: boolean;
  usageAlerts: boolean;
  accountLifecycle: boolean;
  dailyDigest: boolean;
  timezone: string;
};

const OPTIONS: Array<{
  key: keyof Preferences;
  label: string;
  detail: string;
}> = [
  {
    key: 'runFailure',
    label: 'Failed and timed-out Runs',
    detail: 'Recommended for operational failures.',
  },
  {
    key: 'runSuccess',
    label: 'Successful Runs',
    detail: 'Off by default to reduce email volume.',
  },
  {
    key: 'runCanceled',
    label: 'Canceled Runs',
    detail: 'Notify when a Run reaches canceled state.',
  },
  {
    key: 'scheduledAlerts',
    label: 'Scheduling alerts',
    detail: 'Quota, plan, and repeated admission failures.',
  },
  {
    key: 'billingAlerts',
    label: 'Billing alerts',
    detail: 'Payment issues and subscription changes.',
  },
  {
    key: 'usageAlerts',
    label: 'Usage and storage alerts',
    detail: 'Threshold notices at 80%, 95%, and 100%.',
  },
  {
    key: 'accountLifecycle',
    label: 'Account lifecycle alerts',
    detail: 'Routine account lifecycle messages.',
  },
  {
    key: 'dailyDigest',
    label: 'Daily digest',
    detail: 'Preference reserved; digest generation is deferred.',
  },
];

export function NotificationPreferences() {
  const [value, setValue] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/notifications/preferences')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setValue((await response.json()).data);
      })
      .catch(() => setError('Unable to load notification preferences.'));
  }, []);

  const save = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error();
      setValue((await response.json()).data);
      setMessage('Notification preferences saved.');
    } catch {
      setError('Unable to save notification preferences. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        Email notifications
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Choose operational messages sent to the email on your account.
      </p>
      {!value && !error ? (
        <div className="mt-5 h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      ) : null}
      {value ? (
        <div className="mt-5 space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <input
              type="checkbox"
              checked={value.emailEnabled}
              onChange={(event) =>
                setValue({ ...value, emailEnabled: event.target.checked })
              }
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Enable email delivery</span>
              <span className="text-sm text-slate-500">
                Notification history is retained when email is disabled.
              </span>
            </span>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={Boolean(value[option.key])}
                  disabled={!value.emailEnabled || option.key === 'dailyDigest'}
                  onChange={(event) =>
                    setValue({ ...value, [option.key]: event.target.checked })
                  }
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <label className="block max-w-sm text-sm font-medium">
            Timezone
            <input
              value={value.timezone}
              maxLength={100}
              onChange={(event) =>
                setValue({ ...value, timezone: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
            />
          </label>
          <p className="text-xs text-slate-500">
            Critical account-deletion completion and retry messages are
            mandatory when server email delivery is enabled.
          </p>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </Card>
  );
}
