'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DEFAULT_GROQ_MODEL } from '@/lib/execution/groq-models';
import {
  providerLabel,
  type ExecutionModelOption,
} from '@/lib/execution/model-client';
import { TemplateAgentWizard } from '@/components/dashboard/template-agent-wizard';
import { AgentVariableEditor } from '@/components/dashboard/agent-variable-fields';
import type { AgentVariableView } from '@/lib/variables/client-types';
import {
  OutputSchemaEditor,
  type OutputSchemaView,
} from '@/components/dashboard/output-schema-editor';

export default function CreateAgentPage() {
  const router = useRouter();
  const templateId = useSearchParams().get('template');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [variables, setVariables] = useState<AgentVariableView[]>([]);
  const [outputSchema, setOutputSchema] = useState<OutputSchemaView | null>(
    null
  );
  const [modelOptions, setModelOptions] = useState<ExecutionModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(
    DEFAULT_GROQ_MODEL.id
  );

  useEffect(() => {
    void fetch('/api/execution-models')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const models = Array.isArray(payload?.data) ? payload.data : [];
        setModelOptions(models);
        if (models.length)
          setSelectedModel((current) =>
            models.some((model: ExecutionModelOption) => model.id === current)
              ? current
              : models[0].id
          );
      })
      .catch(() => undefined);
  }, []);

  if (templateId) return <TemplateAgentWizard templateId={templateId} />;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modelOptions.length === 0) {
      setError('No configured AI model provider is available.');
      return;
    }
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
        model: String(formData.get('model') ?? DEFAULT_GROQ_MODEL.id),
        maxSteps: Number(formData.get('maxSteps') ?? 25),
        timeoutMs: Number(formData.get('timeoutMs') ?? 60000),
        browserSettings: {
          headless: formData.get('headless') === 'on',
          viewportWidth: Number(formData.get('viewportWidth') ?? 1280),
          viewportHeight: Number(formData.get('viewportHeight') ?? 720),
        },
      },
      variables: variables.map(({ id: _id, ...variable }) => variable),
      safetyPolicy: {
        allowedDomains: String(formData.get('allowedDomains') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        blockedDomains: String(formData.get('blockedDomains') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        allowSubdomains: formData.get('allowSubdomains') === 'on',
        redirectPolicy: String(formData.get('redirectPolicy') ?? 'SAME_DOMAIN'),
        allowDownloads: false,
        allowUploads: false,
        formSubmissionMode: String(
          formData.get('formSubmissionMode') ?? 'SAFE_ONLY'
        ),
        allowDestructiveActions:
          formData.get('allowDestructiveActions') === 'on',
        maxNavigations: Number(formData.get('maxNavigations') ?? 20),
        maxPages: Number(formData.get('maxPages') ?? 3),
        sensitiveDomainMode: 'BLOCK',
      },
      outputSchema,
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
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Create agent
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          New browser automation agent
        </h1>
      </div>

      <Card className="p-6">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Name
              </span>
              <input
                name="name"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Target Website
              </span>
              <input
                name="targetWebsite"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
              <span className="block text-xs text-slate-500">
                The starting page for this Agent. Use a complete HTTPS address.
              </span>
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Description
            </span>
            <textarea
              name="description"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              rows={3}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Goal
            </span>
            <textarea
              name="goal"
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              rows={3}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                AI Model
              </span>
              <select
                name="model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              >
                {modelOptions.length === 0 && (
                  <option value={selectedModel} disabled>
                    No configured model provider
                  </option>
                )}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {providerLabel(model.provider)} — {model.label}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-slate-500">
                Choose from the AI models configured for this deployment.
              </span>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Max Steps
              </span>
              <input
                name="maxSteps"
                type="number"
                min="1"
                max="200"
                defaultValue="25"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Timeout (ms)
              </span>
              <input
                name="timeoutMs"
                type="number"
                min="5000"
                max="900000"
                defaultValue="60000"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
              <span className="block text-xs text-slate-500">
                60,000 ms = 1 minute · 300,000 ms = 5 minutes.
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Status
              </span>
              <select
                name="status"
                defaultValue="PAUSED"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Schedule
              </span>
              <select
                name="scheduleType"
                defaultValue="MANUAL"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              >
                <option value="MANUAL">Manual</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Viewport Width
              </span>
              <input
                name="viewportWidth"
                type="number"
                defaultValue="1280"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Viewport Height
              </span>
              <input
                name="viewportHeight"
                type="number"
                defaultValue="720"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              name="headless"
              defaultChecked
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Run browser in the background (recommended)
          </label>

          <AgentVariableEditor variables={variables} onChange={setVariables} />

          <OutputSchemaEditor value={outputSchema} onChange={setOutputSchema} />

          <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div>
              <legend className="text-base font-semibold text-slate-900 dark:text-white">
                Execution safety
              </legend>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Control where the Agent may navigate and which interactions it
                may perform. These safeguards are enforced for every Run.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">Allowed domains</span>
                <input
                  name="allowedDomains"
                  placeholder="Defaults to the target domain"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="block text-xs text-slate-500">
                  Comma-separated domains only; no paths or wildcards.
                </span>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Blocked domains</span>
                <input
                  name="blockedDomains"
                  placeholder="example.invalid"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-2">
                <span className="text-sm font-medium">Redirects</span>
                <select
                  name="redirectPolicy"
                  defaultValue="SAME_DOMAIN"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="SAME_DOMAIN">Same domain</option>
                  <option value="ALLOWED_DOMAINS">Allowed domains</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Forms</span>
                <select
                  name="formSubmissionMode"
                  defaultValue="SAFE_ONLY"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="BLOCKED">Blocked</option>
                  <option value="SAFE_ONLY">Safe only</option>
                  <option value="ALLOWED">Allowed</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Max navigations</span>
                <input
                  name="maxNavigations"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="20"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Max pages</span>
                <input
                  name="maxPages"
                  type="number"
                  min="1"
                  max="10"
                  defaultValue="3"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allowSubdomains" /> Allow
                subdomains
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allowDestructiveActions" /> Allow
                destructive actions
              </label>
              <span className="text-slate-500">
                Always blocked: downloads, uploads, payments, private networks
              </span>
            </div>
          </fieldset>

          {error ? (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || modelOptions.length === 0}
            >
              {isSubmitting ? 'Creating…' : 'Create Agent'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
