import type {
  AgentExecutionInput,
  AgentExecutionResult,
  AgentExecutionService,
} from './types';

export interface BrowserUseExecutionContext {
  createRun(input: {
    agentId: string;
    userId: string;
  }): Promise<{ runId: string }>;
  startRun(input: { runId: string }): Promise<{ startedAt: Date }>;
  completeRun(input: {
    runId: string;
    completedAt: Date;
    durationMs: number;
    result: string | null;
  }): Promise<void>;
  failRun(input: {
    runId: string;
    completedAt: Date;
    durationMs: number;
    errorMessage: string;
  }): Promise<void>;
  loadExecutionTask(input: {
    agentId: string;
    userId: string;
  }): Promise<{ task: string }>;
  executeTask(input: { task: string }): Promise<{ result: string | null }>;
}

export class BrowserUseExecutionAdapter implements AgentExecutionService {
  constructor(private readonly context: BrowserUseExecutionContext) {}

  async runAgent(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const { runId } = await this.context.createRun(input);
    const { startedAt } = await this.context.startRun({ runId });
    const startedAtMs = startedAt.getTime();

    try {
      const { task } = await this.context.loadExecutionTask(input);
      const execution = await this.context.executeTask({ task });
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAtMs;
      const result = execution.result;

      await this.context.completeRun({
        runId,
        completedAt,
        durationMs,
        result,
      });

      return {
        runId,
        status: 'completed',
        startedAt,
        completedAt,
        durationMs,
        result,
        errorMessage: null,
        events: [],
        screenshots: [],
        visitedUrls: [],
        rawOutput: null,
      };
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAtMs;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown execution error';

      await this.context.failRun({
        runId,
        completedAt,
        durationMs,
        errorMessage,
      });

      return {
        runId,
        status: 'failed',
        startedAt,
        completedAt,
        durationMs,
        result: null,
        errorMessage,
        events: [],
        screenshots: [],
        visitedUrls: [],
        rawOutput: null,
      };
    }
  }
}
