'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { LoadingSkeleton } from '@/components/dashboard/loading-skeleton';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { SchedulesDashboard } from '@/components/dashboard/schedules-dashboard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DEFAULT_GROQ_MODEL } from '@/lib/execution/groq-models';
import {
  providerLabel,
  type ExecutionModelOption,
} from '@/lib/execution/model-client';
import type { RunRecord, RunsResponse } from '@/lib/types';
import { formatDate } from '@/lib/utils/format-date';
import { formatRunResult } from '@/lib/utils/format-run-result';
import {
  AgentVariableEditor,
  VariableValueFields,
} from '@/components/dashboard/agent-variable-fields';
import type {
  AgentVariableView,
  VariableValues,
} from '@/lib/variables/client-types';
import {
  OutputSchemaEditor,
  type OutputSchemaView,
} from '@/components/dashboard/output-schema-editor';

type Agent = {
  id: string;
  name: string;
  description?: string | null;
  goal: string;
  targetWebsite: string;
  status: string;
  configuration?: {
    model?: string;
    maxSteps?: number;
    timeoutMs?: number;
    browserSettings?: {
      headless?: boolean;
      viewportWidth?: number;
      viewportHeight?: number;
    };
  } | null;
  variableVersion: number;
  variables: AgentVariableView[];
  safetyPolicy: SafetyPolicy;
  outputSchema: OutputSchemaView | null;
};

type SafetyPolicy = {
  allowedDomains: string[];
  blockedDomains: string[];
  allowSubdomains: boolean;
  redirectPolicy: 'SAME_DOMAIN' | 'ALLOWED_DOMAINS';
  formSubmissionMode: 'BLOCKED' | 'SAFE_ONLY' | 'ALLOWED';
  allowDestructiveActions: boolean;
  maxNavigations: number;
  maxPages: number;
  allowDownloads: false;
  allowUploads: false;
  sensitiveDomainMode: 'BLOCK' | 'ALLOW';
};

const RUNNING_STATUSES = new Set(['QUEUED', 'RUNNING']);

export function AgentDetailClient({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(
    DEFAULT_GROQ_MODEL.id as string
  );
  const [modelOptions, setModelOptions] = useState<ExecutionModelOption[]>([]);
  const [updatingModel, setUpdatingModel] = useState(false);
  const [variableValues, setVariableValues] = useState<VariableValues>({});
  const [editingVariables, setEditingVariables] = useState<
    AgentVariableView[] | null
  >(null);
  const [savingVariables, setSavingVariables] = useState(false);
  const [safetyDraft, setSafetyDraft] = useState<SafetyPolicy | null>(null);
  const [savingSafety, setSavingSafety] = useState(false);
  const [outputSchemaDraft, setOutputSchemaDraft] =
    useState<OutputSchemaView | null>(null);
  const [savingOutputSchema, setSavingOutputSchema] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptRef = useRef(0);

  async function loadAgentDetails() {
    try {
      const [agentResponse, runsResponse, modelsResponse] = await Promise.all([
        fetch(`/api/agents/${id}`),
        fetch(`/api/runs?agentId=${encodeURIComponent(id)}`),
        fetch('/api/execution-models'),
      ]);

      if (!agentResponse.ok || !runsResponse.ok) {
        throw new Error('Unable to load agent details.');
      }

      const [agentPayload, runsPayload]: [
        { data?: Agent | null },
        Partial<RunsResponse>,
      ] = await Promise.all([agentResponse.json(), runsResponse.json()]);
      const modelsPayload = modelsResponse.ok
        ? await modelsResponse.json().catch(() => null)
        : null;
      const availableModels: ExecutionModelOption[] = Array.isArray(
        modelsPayload?.data
      )
        ? modelsPayload.data
        : [];
      setModelOptions(availableModels);

      const currentAgent = agentPayload?.data ?? null;
      const allRuns = Array.isArray(runsPayload?.data) ? runsPayload.data : [];
      const filteredRuns = allRuns.filter((run) => run.agent?.id === id);

      setAgent(currentAgent);
      if (currentAgent) {
        setSafetyDraft(currentAgent.safetyPolicy);
        setOutputSchemaDraft(currentAgent.outputSchema ?? null);
        setVariableValues((current) =>
          Object.fromEntries(
            (currentAgent.variables ?? []).flatMap((variable) => {
              if (Object.prototype.hasOwnProperty.call(current, variable.key))
                return [[variable.key, current[variable.key]]];
              return variable.defaultValue
                ? [[variable.key, variable.defaultValue]]
                : [];
            })
          )
        );
      }
      const savedModel = currentAgent?.configuration?.model;
      setSelectedModel(
        typeof savedModel === 'string'
          ? savedModel
          : (availableModels[0]?.id ?? DEFAULT_GROQ_MODEL.id)
      );
      setRuns(filteredRuns);
      setRunning(filteredRuns.some((run) => RUNNING_STATUSES.has(run.status)));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load agent details.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgentDetails();
  }, [id]);

  useEffect(() => {
    if (!running) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(
      () => {
        void loadAgentDetails();
        pollAttemptRef.current += 1;
      },
      Math.min(2000 * Math.pow(1.5, pollAttemptRef.current), 10000)
    );

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [running]);

  async function runAgent() {
    if (starting || running) return;
    setError(null);
    setActiveRunId(null);
    setStarting(true);
    setRunning(true);

    try {
      const response = await fetch(`/api/agents/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: variableValues }),
      });

      if (!response.ok) {
        const payload: {
          error?: string;
          code?: string;
          activeRunId?: string;
        } | null = await response.json().catch(() => null);
        if (
          payload?.code === 'AGENT_RUN_ALREADY_ACTIVE' &&
          payload.activeRunId
        ) {
          setActiveRunId(payload.activeRunId);
        }
        throw new Error(payload?.error ?? 'Unable to run agent.');
      }

      const payload: {
        data?: { runId?: string; detailsUrl?: string; status?: string };
      } = await response.json();
      const detailsUrl = payload.data?.detailsUrl;
      if (detailsUrl) {
        window.location.href = detailsUrl;
        return;
      }
      await loadAgentDetails();
    } catch (runError) {
      setRunning(false);
      setError(
        runError instanceof Error ? runError.message : 'Unable to run agent.'
      );
    } finally {
      setStarting(false);
    }
  }

  async function saveVariables() {
    if (!editingVariables || savingVariables) return;
    setSavingVariables(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${id}/variables`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: editingVariables.map(
            ({ id: _id, ...variable }) => variable
          ),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? 'Unable to update variables.');
      setEditingVariables(null);
      await loadAgentDetails();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update variables.'
      );
    } finally {
      setSavingVariables(false);
    }
  }

  async function deleteAgent() {
    const confirmed = window.confirm('Delete this agent?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to delete agent.');
      }

      window.location.href = '/dashboard/agents';
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete agent.'
      );
    }
  }

  async function updateModel() {
    if (!agent?.configuration || updatingModel) return;
    setError(null);
    setUpdatingModel(true);
    try {
      const browserSettings = agent.configuration.browserSettings;
      const response = await fetch(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configuration: {
            model: selectedModel,
            maxSteps: agent.configuration.maxSteps ?? 25,
            timeoutMs: agent.configuration.timeoutMs ?? 60_000,
            browserSettings: {
              headless: browserSettings?.headless ?? true,
              viewportWidth: browserSettings?.viewportWidth ?? 1280,
              viewportHeight: browserSettings?.viewportHeight ?? 720,
            },
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to update the model.');
      }
      await loadAgentDetails();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update the model.'
      );
    } finally {
      setUpdatingModel(false);
    }
  }

  async function saveSafetyPolicy() {
    if (!safetyDraft || savingSafety) return;
    setSavingSafety(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ safetyPolicy: safetyDraft }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? 'Unable to update execution safety.');
      await loadAgentDetails();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update execution safety.'
      );
    } finally {
      setSavingSafety(false);
    }
  }

  async function saveOutputSchema() {
    if (savingOutputSchema) return;
    setSavingOutputSchema(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputSchema: outputSchemaDraft }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? 'Unable to update output schema.');
      await loadAgentDetails();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update output schema.'
      );
    } finally {
      setSavingOutputSchema(false);
    }
  }

  if (loading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorState message={error} />
        {activeRunId && (
          <Link
            href={`/dashboard/runs/${activeRunId}`}
            className="text-sm font-medium text-slate-900 underline underline-offset-4 dark:text-white"
          >
            View active run
          </Link>
        )}
      </div>
    );
  }

  if (!agent) {
    return (
      <EmptyState
        title="Agent not found"
        description="The requested agent could not be loaded."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Agent detail
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {agent.name}
          </h1>
          {running && (
            <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">
              Execution in progress... This page will refresh automatically.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={runAgent}
            disabled={starting || running}
          >
            {starting ? 'Starting...' : running ? 'Running...' : 'Run Agent'}
          </Button>
          <Button variant="danger" onClick={deleteAgent}>
            Delete Agent
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={agent.status} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Goal
              </p>
              <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                {agent.goal}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Website
              </p>
              <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                {agent.targetWebsite}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Description
              </p>
              <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                {agent.description ?? 'No description provided.'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Configuration
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Model</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {agent.configuration?.model ?? 'Unknown'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Max Steps</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {agent.configuration?.maxSteps ?? 'Unknown'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Timeout</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {agent.configuration?.timeoutMs ?? 'Unknown'} ms
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Headless</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {agent.configuration?.browserSettings?.headless ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                AI model
              </span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {!modelOptions.some((model) => model.id === selectedModel) && (
                  <option value={selectedModel} disabled>
                    Saved model (provider unavailable)
                  </option>
                )}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {providerLabel(model.provider)} — {model.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={updateModel}
              disabled={
                updatingModel ||
                !modelOptions.some((model) => model.id === selectedModel)
              }
            >
              {updatingModel ? 'Updating...' : 'Update'}
            </Button>
          </div>
          {!modelOptions.some(
            (model) => model.id === agent.configuration?.model
          ) && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              The saved model provider is unavailable. Select a configured
              supported model before running this agent.
            </p>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <OutputSchemaEditor
          value={outputSchemaDraft}
          onChange={setOutputSchemaDraft}
        />
        <Button onClick={saveOutputSchema} disabled={savingOutputSchema}>
          {savingOutputSchema ? 'Saving…' : 'Save output schema'}
        </Button>
      </Card>

      {safetyDraft ? (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-lg font-semibold">Execution safety</h2>
            <p className="text-sm text-slate-500">
              Worker-enforced rules are snapshotted when each Run is admitted.
              Private networks, unsafe schemes, downloads, uploads, sensitive
              domains, and payments remain blocked.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Allowed domains</span>
              <input
                value={safetyDraft.allowedDomains.join(', ')}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    allowedDomains: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Blocked domains</span>
              <input
                value={safetyDraft.blockedDomains.join(', ')}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    blockedDomains: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">Redirects</span>
              <select
                value={safetyDraft.redirectPolicy}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    redirectPolicy: event.target
                      .value as SafetyPolicy['redirectPolicy'],
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="SAME_DOMAIN">Same domain</option>
                <option value="ALLOWED_DOMAINS">Allowed domains</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Forms</span>
              <select
                value={safetyDraft.formSubmissionMode}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    formSubmissionMode: event.target
                      .value as SafetyPolicy['formSubmissionMode'],
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="BLOCKED">Blocked</option>
                <option value="SAFE_ONLY">Safe only</option>
                <option value="ALLOWED">Allowed</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Max navigations</span>
              <input
                type="number"
                min="1"
                max="100"
                value={safetyDraft.maxNavigations}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    maxNavigations: Number(event.target.value),
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Max pages</span>
              <input
                type="number"
                min="1"
                max="10"
                value={safetyDraft.maxPages}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    maxPages: Number(event.target.value),
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={safetyDraft.allowSubdomains}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    allowSubdomains: event.target.checked,
                  })
                }
              />{' '}
              Allow subdomains
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={safetyDraft.allowDestructiveActions}
                onChange={(event) =>
                  setSafetyDraft({
                    ...safetyDraft,
                    allowDestructiveActions: event.target.checked,
                  })
                }
              />{' '}
              Allow destructive actions
            </label>
            <span className="text-slate-500">
              Downloads: blocked · Uploads: blocked · Payments: blocked
            </span>
          </div>
          <Button
            variant="secondary"
            onClick={saveSafetyPolicy}
            disabled={savingSafety}
          >
            {savingSafety ? 'Saving…' : 'Save safety policy'}
          </Button>
        </Card>
      ) : null}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Run inputs</h2>
            <p className="text-sm text-slate-500">
              Values are validated and snapshotted when the Run is admitted.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              setEditingVariables(
                editingVariables
                  ? null
                  : (agent.variables ?? []).map((item) => ({ ...item }))
              )
            }
          >
            {editingVariables ? 'Cancel variable edit' : 'Edit variables'}
          </Button>
        </div>
        {editingVariables ? (
          <>
            <AgentVariableEditor
              variables={editingVariables}
              onChange={setEditingVariables}
            />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Removing or changing a required variable pauses affected
              schedules; historical Run snapshots are unchanged.
            </p>
            <Button onClick={saveVariables} disabled={savingVariables}>
              {savingVariables ? 'Saving…' : 'Save variables'}
            </Button>
          </>
        ) : agent.variables?.length ? (
          <VariableValueFields
            variables={agent.variables}
            values={variableValues}
            onChange={setVariableValues}
            idPrefix="run-variable"
          />
        ) : (
          <p className="text-sm text-slate-500">
            This Agent has no reusable variables.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <SchedulesDashboard agentId={id} compact />
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Execution history
        </h2>
        <div className="mt-4 space-y-3">
          {runs.length === 0 ? (
            <EmptyState
              title="No execution history"
              description="This agent has not run yet."
            />
          ) : (
            runs.map((run) => (
              <div
                key={run.id}
                className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {formatDate(run.startedAt)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Completed:{' '}
                      {run.completedAt ? formatDate(run.completedAt) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {run.duration ?? '—'} ms
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {formatRunResult(run.result)}
                    </span>
                    <Link
                      href={`/dashboard/runs/${run.id}`}
                      className="text-sm font-medium text-slate-900 underline underline-offset-4 dark:text-white"
                    >
                      View details
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
