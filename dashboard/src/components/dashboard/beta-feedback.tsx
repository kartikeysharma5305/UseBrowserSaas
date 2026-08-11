'use client';

import { useEffect, useState } from 'react';

type Item = {
  id: string;
  category: string;
  message: string;
  status: string;
  releaseVersion: string;
  createdAt: string;
};

export function BetaFeedback() {
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('BUG');
  const [notice, setNotice] = useState('');
  async function load() {
    const response = await fetch('/api/beta/feedback');
    const body = await response.json();
    if (response.ok) setItems(body.data);
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice('');
    const response = await fetch('/api/beta/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        message,
        contextPath: window.location.pathname,
      }),
    });
    const body = await response.json().catch(() => null);
    setNotice(
      response.ok
        ? 'Feedback submitted. Thank you.'
        : (body?.error ?? 'Feedback could not be submitted.')
    );
    if (response.ok) {
      setMessage('');
      await load();
    }
  }
  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <label className="block text-sm font-medium">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 block w-full rounded border p-2 dark:bg-slate-950"
          >
            {[
              'BUG',
              'USABILITY',
              'FEATURE_REQUEST',
              'RUN_FAILURE',
              'PERFORMANCE',
              'BILLING',
              'OTHER',
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Feedback
          <textarea
            required
            minLength={3}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 min-h-32 block w-full rounded border p-2 dark:bg-slate-950"
            placeholder="Do not include passwords, API keys, task content, or other secrets."
          />
        </label>
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">
          Submit feedback
        </button>
        {notice ? <p className="text-sm">{notice}</p> : null}
      </form>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Your submissions</h2>
        <div className="space-y-2">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <div className="font-medium">
                {item.category} · {item.status}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{item.message}</p>
              <div className="mt-1 text-xs text-slate-500">
                Release {item.releaseVersion}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
