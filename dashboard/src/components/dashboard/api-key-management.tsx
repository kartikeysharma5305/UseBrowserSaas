'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { API_KEY_SCOPES, type ApiKeyScope } from '@/lib/public-api/scopes';

type KeyView = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export function ApiKeyManagement() {
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([
    'agents:read',
    'runs:read',
  ]);
  const [expiry, setExpiry] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const response = await fetch('/api/api-keys', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setKeys((await response.json()).data ?? []);
    } catch {
      setError('Unable to load API keys.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    if (submitting || !name.trim() || !scopes.length) return;
    setSubmitting(true);
    setError(null);
    setPlaintext(null);
    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          scopes,
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? 'Unable to create API key.');
      setPlaintext(payload.data.key);
      setName('');
      setExpiry('');
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to create API key.'
      );
    } finally {
      setSubmitting(false);
    }
  };
  const revoke = async (id: string) => {
    const response = await fetch(`/api/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setError('Unable to revoke API key.');
      return;
    }
    await load();
  };
  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Personal API keys</h2>
        <p className="text-sm text-slate-500">
          Keys provide scoped access to API v1. The secret is shown only once.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Name</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded border p-2 dark:bg-slate-800"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Optional expiry</span>
          <input
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className="w-full rounded border p-2 dark:bg-slate-800"
          />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Scopes</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {API_KEY_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  setScopes(
                    event.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((item) => item !== scope)
                  )
                }
              />
              {scope}
            </label>
          ))}
        </div>
      </fieldset>
      <Button
        onClick={create}
        disabled={submitting || !name.trim() || !scopes.length}
      >
        {submitting ? 'Creating…' : 'Create API key'}
      </Button>
      {plaintext && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30"
        >
          <p className="font-semibold">
            Copy this key now. It cannot be shown again.
          </p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 overflow-auto rounded bg-white p-2 text-xs dark:bg-slate-950">
              {plaintext}
            </code>
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(plaintext)}
            >
              Copy
            </Button>
          </div>
          <Button
            className="mt-2"
            variant="secondary"
            onClick={() => setPlaintext(null)}
          >
            I saved it
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading API keys…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-slate-500">No API keys yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t">
                  <td className="py-3">{key.name}</td>
                  <td>
                    <code>{key.prefix}</code>
                  </td>
                  <td>{key.scopes.join(', ')}</td>
                  <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td>
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString()
                      : 'Never'}
                  </td>
                  <td>
                    {key.status}
                    {key.expiresAt
                      ? ` · expires ${new Date(key.expiresAt).toLocaleDateString()}`
                      : ''}
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={key.status === 'REVOKED'}
                      onClick={() => void revoke(key.id)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Secrets remain only in component memory and are never written to browser
        storage or URLs.
      </p>
    </Card>
  );
}
