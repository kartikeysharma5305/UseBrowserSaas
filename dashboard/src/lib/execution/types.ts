export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface AgentExecutionInput {
  agentId: string;
  userId: string;
  variables?: Record<string, string | number | boolean>;
  trustedRunId?: string;
  source?: 'API';
  scheduled?: {
    scheduleId: string;
    occurrenceId: string;
    scheduledFor: Date;
  };
}

export interface AgentExecutionResult {
  runId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  visitedUrls: string[];
  eventCount: number;
  artifactCount: number;
  detailsUrl: string;
}
