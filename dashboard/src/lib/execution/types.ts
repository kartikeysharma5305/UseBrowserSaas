export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentExecutionInput {
  agentId: string;
  userId: string;
}

export interface ExecutionEvent {
  type: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface ExecutionScreenshot {
  stepNumber: number | null;
  path: string | null;
  base64: string | null;
}

export interface AgentExecutionResult {
  runId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  result: string | null;
  errorMessage: string | null;
  events: ExecutionEvent[];
  screenshots: ExecutionScreenshot[];
  visitedUrls: string[];
  rawOutput: unknown;
}

export interface AgentExecutionService {
  runAgent(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
