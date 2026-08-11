export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELED';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RunRecord {
  id: string;
  agentId: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  result: JsonValue;
  outputSchemaSnapshot?: JsonValue;
  outputSchemaVersion?: number | null;
  structuredStatus?:
    | 'NOT_REQUESTED'
    | 'PENDING'
    | 'VALID'
    | 'PARTIAL'
    | 'INVALID'
    | 'PARSE_FAILED'
    | 'TOO_LARGE';
  structuredResult?: JsonValue;
  structuredErrors?: JsonValue;
  structuredValidatedAt?: string | null;
  errorMessage: string | null;
  queuedAt?: string | null;
  attempt?: number;
  cancelRequestedAt?: string | null;
  canceledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  model?: string | null;
  provider?: 'groq' | 'nvidia' | null;
  inputSnapshot?: {
    schemaVersion: number;
    definitionVersion: number;
    values: Array<{
      key: string;
      label: string;
      type: 'TEXT' | 'URL' | 'NUMBER' | 'BOOLEAN' | 'SECRET';
      value: string | number | boolean;
      source: 'supplied' | 'default';
      redacted: boolean;
    }>;
    rendered: { goal: string; targetWebsite: string };
  } | null;
  agent?: {
    id: string;
    name: string;
    targetWebsite: string;
  };
  events?: AgentEventRecord[];
  artifacts?: RunArtifactRecord[];
}

export interface BrowserRunResult {
  summary?: string | null;
  visitedUrls?: string[];
}

export interface AgentEventRecord {
  id: string;
  runId: string;
  sequence?: number;
  type: string;
  message: string;
  data?: JsonValue;
  timestamp: string;
}

export interface RunArtifactRecord {
  id: string;
  type: 'SCREENSHOT';
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg';
  size: number;
  stepNumber: number | null;
  eventSequence: number | null;
  createdAt: string;
  url: string;
}

export interface ApiDataResponse<T> {
  data: T;
}

export type RunsResponse = ApiDataResponse<RunRecord[]>;
export type RunResponse = ApiDataResponse<RunRecord>;

export const RUN_STREAM_VERSION = 1 as const;

export type RunStreamConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'closed';

export interface RunStreamSnapshot {
  version: typeof RUN_STREAM_VERSION;
  run: RunRecord;
}

export interface RunStreamStatus {
  version: typeof RUN_STREAM_VERSION;
  runId: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  result: JsonValue;
  errorMessage: string | null;
  cancelRequestedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface RunStreamAgentEvent {
  version: typeof RUN_STREAM_VERSION;
  event: AgentEventRecord;
}

export interface RunStreamArtifact {
  version: typeof RUN_STREAM_VERSION;
  artifact: RunArtifactRecord;
}
