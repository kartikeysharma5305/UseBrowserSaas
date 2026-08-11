'use client';

import { useCallback, useEffect, useState } from 'react';
import { WEBHOOK_EVENT_TYPES } from '@/lib/webhooks/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Endpoint = {
  id: string;
  name: string;
  url: string;
  status: 'ENABLED' | 'DISABLED';
  eventTypes: string[];
  secretPrefix: string;
  consecutiveFailures: number;
};
type Delivery = {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  httpStatus: number | null;
  failureCode: string | null;
};

export function WebhookManagement() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([
    'run.succeeded',
    'run.failed',
  ]);
  const [secret, setSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/webhooks', { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error ?? 'Unable to load webhooks.');
    setEndpoints(payload.data);
  }, []);

  useEffect(() => {
    void load().catch(() => setError('Unable to load webhooks.'));
  }, [load]);

  async function command(path: string, method = 'POST', body?: unknown) {
    const response = await fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error ?? 'Webhook action failed.');
    return payload.data;
  }

  async function create() {
    if (busy) return;
    setBusy('create');
    setError(null);
    try {
      const created = await command('/api/webhooks', 'POST', {
        name,
        url,
        eventTypes,
      });
      setSecret(created.secret);
      setName('');
      setUrl('');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to create webhook.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function act(
    id: string,
    action: 'toggle' | 'rotate' | 'test' | 'delete'
  ) {
    if (busy) return;
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      const endpoint = endpoints.find((item) => item.id === id)!;
      if (action === 'toggle')
        await command(`/api/webhooks/${id}`, 'PATCH', {
          enabled: endpoint.status !== 'ENABLED',
        });
      if (action === 'rotate') {
        const rotated = await command(`/api/webhooks/${id}/rotate-secret`);
        setSecret(rotated.secret);
      }
      if (action === 'test') await command(`/api/webhooks/${id}/test`);
      if (action === 'delete') await command(`/api/webhooks/${id}`, 'DELETE');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Webhook action failed.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function history(id: string) {
    setBusy(`${id}:history`);
    try {
      const response = await fetch(`/api/webhooks/${id}/deliveries?limit=20`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDeliveries((current) => ({ ...current, [id]: payload.data }));
    } catch {
      setError('Unable to load delivery history.');
    } finally {
      setBusy(null);
    }
  }

  async function updateEvents(endpoint: Endpoint, next: string[]) {
    if (!next.length || busy) return;
    setBusy(`${endpoint.id}:events`);
    try {
      await command(`/api/webhooks/${endpoint.id}`, 'PATCH', {
        eventTypes: next,
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update subscriptions.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function replay(endpointId: string, deliveryId: string) {
    setBusy(`${deliveryId}:replay`);
    try {
      await command(`/api/webhooks/deliveries/${deliveryId}/replay`);
      await history(endpointId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to replay delivery.'
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Outbound webhooks</h2>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-500">
          Send signed, minimal Run and scheduling events to your HTTPS endpoint.
        </p>
        {secret ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium">
              Copy this signing secret now. It will not be shown again.
            </p>
            <code className="mt-2 block break-all">{secret}</code>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(secret)}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSecret(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="Webhook name"
            className="rounded-lg border px-3 py-2 dark:bg-slate-900"
            placeholder="Production automation"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            aria-label="Webhook URL"
            className="rounded-lg border px-3 py-2 dark:bg-slate-900"
            placeholder="https://example.com/webhooks"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Events</legend>
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={eventTypes.includes(type)}
                onChange={(event) =>
                  setEventTypes((current) =>
                    event.target.checked
                      ? [...current, type]
                      : current.filter((item) => item !== type)
                  )
                }
              />
              {type}
            </label>
          ))}
        </fieldset>
        <Button
          type="button"
          disabled={Boolean(busy) || !name || !url || !eventTypes.length}
          onClick={() => void create()}
        >
          {busy === 'create' ? 'Creating…' : 'Create endpoint'}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {!endpoints.length ? (
          <p className="text-sm text-slate-500">
            No webhook endpoints configured.
          </p>
        ) : null}
        <div className="space-y-3">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="rounded-lg border p-3">
              <div className="flex flex-col justify-between gap-2 md:flex-row">
                <div className="min-w-0">
                  <p className="font-medium">
                    {endpoint.name} · {endpoint.status}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {endpoint.url}
                  </p>
                  <p className="text-xs text-slate-500">
                    Secret {endpoint.secretPrefix}… · failures{' '}
                    {endpoint.consecutiveFailures}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void act(endpoint.id, 'toggle')}
                  >
                    {endpoint.status === 'ENABLED' ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={endpoint.status !== 'ENABLED'}
                    onClick={() => void act(endpoint.id, 'test')}
                  >
                    Test
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void act(endpoint.id, 'rotate')}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void history(endpoint.id)}
                  >
                    History
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void act(endpoint.id, 'delete')}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Edit subscriptions
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {WEBHOOK_EVENT_TYPES.map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={endpoint.eventTypes.includes(type)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...endpoint.eventTypes, type]
                            : endpoint.eventTypes.filter(
                                (item) => item !== type
                              );
                          void updateEvents(endpoint, next);
                        }}
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </details>
              {deliveries[endpoint.id]?.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {deliveries[endpoint.id].map((delivery) => (
                        <tr key={delivery.id} className="border-t">
                          <td className="py-2">{delivery.eventType}</td>
                          <td>{delivery.status}</td>
                          <td>attempts {delivery.attemptCount}</td>
                          <td>
                            {delivery.failureCode ?? delivery.httpStatus ?? '—'}
                          </td>
                          <td>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void replay(endpoint.id, delivery.id)
                              }
                            >
                              Replay
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
