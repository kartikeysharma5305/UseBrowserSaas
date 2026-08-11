'use client';

import { useState } from 'react';

export function BetaOperations({ initial }: { initial: any }) {
  const [data, setData] = useState(initial);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const response = await fetch('/api/internal/beta');
    if (response.ok) setData(await response.json());
  }
  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/internal/beta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        planCode: form.get('planCode'),
        note: form.get('note') || undefined,
      }),
    });
    const body = await response.json();
    setToken(
      response.ok
        ? `${location.origin}/register?invite=${encodeURIComponent(body.data.inviteToken)}`
        : ''
    );
    setNotice(
      response.ok
        ? 'Invitation created. Copy this URL now; it will not be shown again.'
        : body.error
    );
    if (response.ok) {
      event.currentTarget.reset();
      await refresh();
    }
  }
  async function action(url: string, method = 'POST', body?: object) {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) setNotice('Operation failed safely.');
    await refresh();
  }
  return (
    <div className="space-y-8">
      <form
        onSubmit={invite}
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-4 dark:border-slate-800"
      >
        <input
          required
          name="email"
          type="email"
          placeholder="tester@example.com"
          className="rounded border p-2 dark:bg-slate-950"
        />
        <select
          name="planCode"
          className="rounded border p-2 dark:bg-slate-950"
        >
          <option>FREE</option>
          <option>PRO</option>
        </select>
        <input
          name="note"
          maxLength={300}
          placeholder="Private note"
          className="rounded border p-2 dark:bg-slate-950"
        />
        <button className="rounded bg-slate-900 px-3 py-2 text-white dark:bg-white dark:text-slate-900">
          Create invite
        </button>
        {notice ? <p className="md:col-span-4 text-sm">{notice}</p> : null}
        {token ? (
          <output className="break-all rounded bg-amber-50 p-2 text-sm md:col-span-4 dark:bg-amber-950">
            {token}
          </output>
        ) : null}
      </form>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Funnel</h2>
        <pre className="overflow-auto rounded border p-3 text-xs dark:border-slate-800">
          {JSON.stringify(data.funnel, null, 2)}
        </pre>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Reliability · 24h</h2>
        <pre className="overflow-auto rounded border p-3 text-xs dark:border-slate-800">
          {JSON.stringify(data.reliability24h, null, 2)}
        </pre>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Invitations</h2>
        <div className="space-y-2">
          {data.invites.map((i: any) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm dark:border-slate-800"
            >
              <span>{i.email}</span>
              <span>{i.status}</span>
              <span>{i.planCode}</span>
              {['PENDING', 'ACCEPTING'].includes(i.status) ? (
                <button
                  className="underline"
                  onClick={() =>
                    action(`/api/internal/beta/invites/${i.id}/revoke`)
                  }
                >
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Beta users</h2>
        <div className="space-y-2">
          {data.users.map((u: any) => (
            <div
              key={u.id}
              className="rounded border p-3 text-sm dark:border-slate-800"
            >
              <div>
                {u.email} · {u.betaAccessStatus} · {u.planCode} ·{' '}
                {u._count.agents} Agents · {u._count.schedules} schedules
              </div>
              <div className="mt-2 flex gap-3">
                {['ACTIVE', 'SUSPENDED', 'ENDED'].map((state) => (
                  <button
                    key={state}
                    className="underline disabled:opacity-40"
                    disabled={u.betaAccessStatus === state}
                    onClick={() =>
                      action(`/api/internal/beta/users/${u.id}`, 'PATCH', {
                        state,
                      })
                    }
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Feedback</h2>
        <div className="space-y-2">
          {data.feedback.map((f: any) => (
            <div
              key={f.id}
              className="rounded border p-3 text-sm dark:border-slate-800"
            >
              <div>
                {f.category} · {f.status} · release {f.releaseVersion}
              </div>
              <p className="my-2 whitespace-pre-wrap">{f.message}</p>
              <select
                value={f.status}
                onChange={(e) =>
                  action(`/api/internal/beta/feedback/${f.id}`, 'PATCH', {
                    status: e.target.value,
                  })
                }
                className="rounded border p-1 dark:bg-slate-950"
              >
                {['NEW', 'REVIEWING', 'RESOLVED', 'WONT_FIX'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
