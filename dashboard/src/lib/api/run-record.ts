import type {
  Agent,
  AgentEvent,
  Prisma,
  Run,
  RunArtifact,
} from '@prisma/client';

import { sanitizePersistedExecutionError } from '@/lib/execution/errors';
import { toArtifactApiRecord } from '@/lib/observability/artifact-api';
import { sanitizeEventData } from '@/lib/observability/event-data';
import type {
  AgentEventRecord,
  JsonValue,
  RunArtifactRecord,
  RunRecord,
} from '@/lib/types';
import { publicSnapshot } from '@/lib/variables/resolver';

export type RunApiSource = Run & {
  agent: Agent;
  events: AgentEvent[];
  artifacts: RunArtifact[];
};

export function toClientJsonValue(value: Prisma.JsonValue): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toClientJsonValue);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      child === undefined ? [] : [[key, toClientJsonValue(child)]]
    )
  );
}

export function toAgentEventRecord(event: AgentEvent): AgentEventRecord {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    message: event.message,
    data: sanitizeEventData(event.data) as JsonValue,
    timestamp: event.timestamp.toISOString(),
  };
}

export function toRunArtifactRecord(
  artifact: RunArtifact
): RunArtifactRecord | null {
  return toArtifactApiRecord(artifact);
}

export function toRunApiRecord(
  run: RunApiSource,
  options: { includeTimeline?: boolean } = {}
): RunRecord {
  const snapshotConfiguration =
    typeof run.executionConfiguration === 'object' &&
    run.executionConfiguration !== null &&
    !Array.isArray(run.executionConfiguration)
      ? (run.executionConfiguration as Prisma.JsonObject)
      : null;
  const legacyAgentConfiguration =
    typeof run.agent.configuration === 'object' &&
    run.agent.configuration !== null &&
    !Array.isArray(run.agent.configuration)
      ? (run.agent.configuration as Prisma.JsonObject)
      : {};
  const configuration = snapshotConfiguration ?? legacyAgentConfiguration;
  const includeTimeline = options.includeTimeline ?? true;

  return {
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    duration: run.duration,
    result: toClientJsonValue(run.result),
    errorMessage: sanitizePersistedExecutionError(run.errorMessage),
    queuedAt: run.queuedAt?.toISOString() ?? null,
    attempt: run.attempt,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    canceledAt: run.canceledAt?.toISOString() ?? null,
    cancelReason: run.cancelReason?.slice(0, 240) ?? null,
    createdAt: run.createdAt.toISOString(),
    model:
      typeof configuration.model === 'string'
        ? configuration.model.slice(0, 120)
        : null,
    provider:
      configuration.provider === 'groq' || configuration.provider === 'nvidia'
        ? configuration.provider
        : typeof configuration.model === 'string' &&
            configuration.model.startsWith('nvidia_')
          ? 'nvidia'
          : typeof configuration.model === 'string'
            ? 'groq'
            : null,
    inputSnapshot: publicSnapshot(run.inputSnapshot),
    outputSchemaSnapshot: toClientJsonValue(run.outputSchemaSnapshot),
    outputSchemaVersion: run.outputSchemaVersion,
    structuredStatus: run.structuredStatus,
    structuredResult: toClientJsonValue(run.structuredResult),
    structuredErrors: toClientJsonValue(run.structuredErrors),
    structuredValidatedAt: run.structuredValidatedAt?.toISOString() ?? null,
    agent: {
      id: run.agent.id,
      name: run.agent.name,
      targetWebsite: run.agent.targetWebsite,
    },
    events: includeTimeline ? run.events.map(toAgentEventRecord) : [],
    artifacts: includeTimeline
      ? run.artifacts
          .map(toRunArtifactRecord)
          .filter(
            (artifact): artifact is RunArtifactRecord => artifact !== null
          )
      : [],
  };
}
