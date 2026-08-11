'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { PublicTemplate } from './template-catalogue';

export function TemplateAgentWizard({ templateId }: { templateId: string }) {
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const [template, setTemplate] = useState<PublicTemplate | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState<'create' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
      signal: request.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const item = (await response.json()).data as PublicTemplate;
        setTemplate(item);
        setName(item.suggestedName);
        setGoal(item.suggestedGoal);
      })
      .catch((loadError) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        )
          return;
        setError(
          'Unable to load this template. Choose another template and try again.'
        );
      });
    return () => controller.current?.abort();
  }, [templateId]);

  const submit = async (createAndTest: boolean) => {
    if (!template || busy) return;
    setBusy(createAndTest ? 'test' : 'create');
    setError(null);
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch(
        `/api/templates/${encodeURIComponent(template.id)}/create-agent`,
        {
          method: 'POST',
          signal: request.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            goal,
            targetWebsite: website,
            createAndTest,
          }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          payload?.error ??
            'Unable to create Agent. Check the fields and try again.'
        );
      const agentId = payload.data.agent.id as string;
      if (payload.data.run?.detailsUrl) {
        window.location.assign(payload.data.run.detailsUrl);
        return;
      }
      if (payload.data.runAdmissionError) {
        setCreatedAgentId(agentId);
        setError(payload.data.runAdmissionError);
        return;
      }
      router.push(`/dashboard/agents/${agentId}`);
    } catch (submitError) {
      if (
        submitError instanceof DOMException &&
        submitError.name === 'AbortError'
      )
        return;
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to create Agent.'
      );
    } finally {
      setBusy(null);
    }
  };

  if (!template && !error)
    return (
      <div
        aria-label="Loading template"
        className="h-72 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
      />
    );
  if (!template)
    return (
      <Card className="p-6">
        <p className="text-sm text-red-700">{error}</p>
        <Link
          href="/dashboard/templates"
          className="mt-3 inline-block text-sm font-medium underline"
        >
          Back to templates
        </Link>
      </Card>
    );
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          First-Agent wizard · {template.title}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Customize your Agent</h1>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            Agent name
            <input
              aria-label="Agent name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
            />
          </label>
          <label className="block text-sm font-medium">
            Target website
            <input
              aria-label="Target website"
              type="url"
              required
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com/page"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {template.targetWebsiteGuidance}
            </span>
          </label>
          <label className="block text-sm font-medium">
            Task
            <textarea
              aria-label="Agent task"
              value={goal}
              maxLength={1500}
              rows={6}
              onChange={(event) => setGoal(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
            />
          </label>
          <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
            <p className="font-medium">Applied plan-safe limits</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              {template.appliedRecommendation.maxSteps} steps ·{' '}
              {Math.round(template.appliedRecommendation.timeoutMs / 1000)}{' '}
              seconds
            </p>
            {template.appliedRecommendation.adjusted ? (
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                The template recommendation was adjusted to your current plan.
              </p>
            ) : null}
          </div>
          {template.variables?.length ? (
            <div className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
              <p className="font-medium">
                Reusable inputs created with this Agent
              </p>
              <ul className="mt-2 list-disc pl-5 text-slate-600 dark:text-slate-300">
                {template.variables.map((variable) => (
                  <li key={variable.key}>
                    {variable.label} ({variable.type.toLowerCase()})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
              {createdAgentId ? (
                <Link
                  href={`/dashboard/agents/${createdAgentId}`}
                  className="ml-2 font-medium underline"
                >
                  Open the created Agent
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                busy !== null || !name.trim() || !goal.trim() || !website.trim()
              }
              onClick={() => void submit(false)}
            >
              {busy === 'create' ? 'Creating…' : 'Create only'}
            </Button>
            <Button
              variant="secondary"
              disabled={
                busy !== null || !name.trim() || !goal.trim() || !website.trim()
              }
              onClick={() => void submit(true)}
            >
              {busy === 'test' ? 'Creating and queueing…' : 'Create and test'}
            </Button>
            <Link href="/dashboard/templates">
              <Button variant="ghost">Choose another</Button>
            </Link>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="font-semibold">Write a reliable task</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>State one clear goal and name the target website.</li>
          <li>Define the desired output and stopping condition.</li>
          <li>
            Use bounded actions; never include credentials or sensitive data.
          </li>
          <li>Avoid vague, multi-purpose requests.</li>
        </ul>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
            <strong>Strong:</strong> {template.suggestedGoal}
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
            <strong>Too vague:</strong> “Look around this website and tell me
            anything useful.” Improve it by naming one output and a stopping
            point.
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          <strong>Likely failure:</strong> a page requires login, CAPTCHA, or
          private access. Use a directly accessible public page; do not bypass
          controls.
        </p>
      </Card>
    </div>
  );
}
