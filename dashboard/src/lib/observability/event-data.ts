import type { JsonValue } from '@/lib/types';

export const EVENT_TEXT_LIMIT = 500;
export const EVENT_ACTION_LIMIT = 12;
export const EVENT_ARTIFACT_LIMIT = 12;

export interface RunEventData {
  stepNumber?: number;
  actionType?: string;
  actionSummary?: string;
  url?: string;
  success?: boolean;
  error?: string;
  model?: string;
  operation?: string;
  operationStatus?: string;
  durationMs?: number;
  stopped?: boolean;
  paused?: boolean;
  artifactIds?: string[];
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:gsk_|nvapi-|sk-)[a-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(
      /\b(password|passwd|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    );
}

export function truncateEventText(
  value: unknown,
  limit = EVENT_TEXT_LIMIT
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = redactSensitiveText(value).trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > limit
    ? `${normalized.slice(0, Math.max(0, limit - 1))}…`
    : normalized;
}

export function normalizeEventUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeActionSummary(actions: unknown): {
  actionType?: string;
  actionSummary?: string;
} {
  if (!Array.isArray(actions)) {
    return {};
  }

  const actionTypes = actions
    .slice(0, EVENT_ACTION_LIMIT)
    .flatMap((action) =>
      isRecord(action) ? Object.keys(action).slice(0, 1) : []
    )
    .map((action) => truncateEventText(action, 80))
    .filter((action): action is string => Boolean(action));

  if (actionTypes.length === 0) {
    return {};
  }

  return {
    actionType: actionTypes[0],
    actionSummary: truncateEventText(actionTypes.join(', '), 300),
  };
}

export function sanitizeEventData(value: unknown): RunEventData {
  if (!isRecord(value)) {
    return {};
  }

  const output: RunEventData = {};
  if (
    typeof value.stepNumber === 'number' &&
    Number.isSafeInteger(value.stepNumber) &&
    value.stepNumber >= 0
  ) {
    output.stepNumber = value.stepNumber;
  }

  const actionType = truncateEventText(value.actionType, 80);
  const actionSummary = truncateEventText(value.actionSummary, 300);
  const error = truncateEventText(value.error, EVENT_TEXT_LIMIT);
  const model = truncateEventText(value.model, 120);
  const operation = truncateEventText(value.operation, 40);
  const operationStatus = truncateEventText(value.operationStatus, 20);
  const url = normalizeEventUrl(value.url);

  if (actionType) output.actionType = actionType;
  if (actionSummary) output.actionSummary = actionSummary;
  if (url) output.url = url;
  if (typeof value.success === 'boolean') output.success = value.success;
  if (error) output.error = error;
  if (model) output.model = model;
  if (operation) output.operation = operation;
  if (operationStatus) output.operationStatus = operationStatus;
  if (
    typeof value.durationMs === 'number' &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0
  ) {
    output.durationMs = value.durationMs;
  }
  if (typeof value.stopped === 'boolean') output.stopped = value.stopped;
  if (typeof value.paused === 'boolean') output.paused = value.paused;

  if (Array.isArray(value.artifactIds)) {
    const artifactIds = value.artifactIds
      .slice(0, EVENT_ARTIFACT_LIMIT)
      .map((id) => truncateEventText(id, 128))
      .filter((id): id is string => Boolean(id));
    if (artifactIds.length > 0) output.artifactIds = artifactIds;
  }

  return output;
}

export function toEventJson(data: RunEventData): JsonValue {
  return { ...sanitizeEventData(data) };
}
