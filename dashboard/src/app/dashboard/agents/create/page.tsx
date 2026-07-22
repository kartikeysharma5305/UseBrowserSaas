'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function CreateAgentPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      goal: String(formData.get('goal') ?? ''),
      targetWebsite: String(formData.get('targetWebsite') ?? ''),
      status: String(formData.get('status') ?? 'PAUSED'),
      scheduleType: String(formData.get('scheduleType') ?? 'MANUAL'),
      scheduleConfig: {},
      configuration: {
        model: String(formData.get('model') ?? 'gpt-4o-mini'),
        maxSteps: Number(formData.get('maxSteps') ?? 25),
        timeoutMs: Number(formData.get('timeoutMs') ?? 60000),
        browserSettings: {
          headless: formData.get('headless') === 'on',
          viewportWidth: Number(formData.get('viewportWidth') ?? 1280),
          viewportHeight: Number(formData.get('viewportHeight') ?? 720),
        },
      },
    };

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to create agent.');
      }

      const result = await response.json();
      router.push(`/dashboard/agents/${result.data.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to create agent.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">Create agent</p>
        <h1 className="text-3xl font-semibold text-slate-900">
          New browser automation agent
        </h1>
      </div>

      <Card className="p-6">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                name="name"
                required
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Target Website
              </span>
              <input
                name="targetWebsite"
                required
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <textarea
              name="description"
              className="w-full rounded-lg border px-3 py-2"
              rows={3}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Goal</span>
            <textarea
              name="goal"
              required
              className="w-full rounded-lg border px-3 py-2"
              rows={3}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                AI Model
              </span>
              <input
                name="model"
                defaultValue="gpt-4o-mini"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Max Steps
              </span>
              <input
                name="maxSteps"
                type="number"
                min="1"
                max="200"
                defaultValue="25"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Timeout (ms)
              </span>
              <input
                name="timeoutMs"
                type="number"
                min="1000"
                max="120000"
                defaultValue="60000"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Status</span>
              <select
                name="status"
                defaultValue="PAUSED"
                className="w-full rounded-lg border px-3 py-2"
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Schedule
              </span>
              <select
                name="scheduleType"
                defaultValue="MANUAL"
                className="w-full rounded-lg border px-3 py-2"
              >
                <option value="MANUAL">Manual</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Viewport Width
              </span>
              <input
                name="viewportWidth"
                type="number"
                defaultValue="1280"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Viewport Height
              </span>
              <input
                name="viewportHeight"
                type="number"
                defaultValue="720"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="headless" defaultChecked />
            Headless browser
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create Agent'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
