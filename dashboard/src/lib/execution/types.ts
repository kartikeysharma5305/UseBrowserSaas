export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentExecutionInput {
  agentId: string;
  userId: string;
}

export interface AgentExecutionResult {
  runId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  result: string | null;
  errorMessage: string | null;
}

export interface AgentExecutionService {
  runAgent(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
