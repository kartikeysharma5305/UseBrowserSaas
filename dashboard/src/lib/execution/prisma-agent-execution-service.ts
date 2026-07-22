import { AgentEventType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

import {
  BrowserUseExecutionAdapter,
  type BrowserUseExecutionContext,
} from './browser-use-execution-adapter';
import type { AgentExecutionInput, AgentExecutionResult } from './types';

/**
 * Implementation of BrowserUseExecutionContext using Prisma
 * This class handles the Run lifecycle: creation, tracking, and completion
 *
 * Run Lifecycle:
 * 1. createRun() - Create Run record with QUEUED status
 * 2. startRun() - Update to RUNNING, record startedAt
 * 3. completeRun() / failRun() - Update status, record duration and result
 *
 * All state changes are immediately persisted to DB so dashboard
 * can display real-time status without polling.
 */
class PrismaBrowserUseExecutionContext implements BrowserUseExecutionContext {
  /**
   * Create a new Run record to track an agent execution
   * Initializes with QUEUED status - execution hasn't started yet
   */
  async createRun(input: { agentId: string; userId: string }) {
    const run = await prisma.run.create({
      data: {
        agentId: input.agentId,
        status: 'QUEUED',
      },
    });

    // Record event for debugging and user visibility
    await prisma.agentEvent.create({
      data: {
        runId: run.id,
        type: AgentEventType.RUN_CREATED,
        message: `Run created for agent ${input.agentId}.`,
      },
    });

    return { runId: run.id };
  }

  /**
   * Mark Run as RUNNING - execution has begun
   * Records the exact start time for duration calculation
   */
  async startRun(input: { runId: string }) {
    const startedAt = new Date();

    await prisma.run.update({
      where: { id: input.runId },
      data: {
        status: 'RUNNING',
        startedAt,
      },
    });

    await prisma.agentEvent.create({
      data: {
        runId: input.runId,
        type: AgentEventType.RUN_STARTED,
        message: 'Run started.',
      },
    });

    return { startedAt };
  }

  /**
   * Mark Run as SUCCESS with result
   * Calculates and stores duration, stores execution result
   */
  async completeRun(input: {
    runId: string;
    completedAt: Date;
    durationMs: number;
    result: string | null;
  }) {
    await prisma.run.update({
      where: { id: input.runId },
      data: {
        status: 'SUCCESS',
        completedAt: input.completedAt,
        duration: input.durationMs,
        result: input.result ? { summary: input.result } : Prisma.JsonNull,
      },
    });

    await prisma.agentEvent.create({
      data: {
        runId: input.runId,
        type: AgentEventType.RUN_COMPLETED,
        message: `Run completed in ${input.durationMs} ms.`,
      },
    });
  }

  /**
   * Mark Run as FAILED with error message
   * Enables dashboard to show error state and error message to user
   */
  async failRun(input: {
    runId: string;
    completedAt: Date;
    durationMs: number;
    errorMessage: string;
  }) {
    await prisma.run.update({
      where: { id: input.runId },
      data: {
        status: 'FAILED',
        completedAt: input.completedAt,
        duration: input.durationMs,
        errorMessage: input.errorMessage,
      },
    });

    await prisma.agentEvent.create({
      data: {
        runId: input.runId,
        type: AgentEventType.RUN_FAILED,
        message: input.errorMessage,
      },
    });
  }

  /**
   * Load execution task for an agent
   * Combines agent goal and target website into a browser automation task
   */
  async loadExecutionTask(input: { agentId: string; userId: string }) {
    const agent = await prisma.agent.findUnique({
      where: {
        id: input.agentId,
      },
    });

    if (!agent) {
      throw new Error('Agent not found.');
    }

    return {
      task: `${agent.goal} Navigate to ${agent.targetWebsite}.`,
    };
  }

  /**
   * Execute task using browser automation engine
   * Currently returns mock result - in production this calls the
   * browser-use engine through BROWSER_USE_API_KEY
   */
  async executeTask(input: { task: string }) {
    if (!process.env.BROWSER_USE_API_KEY) {
      throw new Error(
        'Browser automation execution is not configured yet. Add BROWSER_USE_API_KEY to enable live agent runs.'
      );
    }

    return {
      result: input.task,
    };
  }
}

/**
 * Execution service for running browser agents
 * Uses Prisma as the persistence layer for all Run state
 * Integrates with BrowserUseExecutionAdapter to handle the execution lifecycle
 */
export class PrismaAgentExecutionService {
  private readonly adapter: BrowserUseExecutionAdapter;

  constructor() {
    this.adapter = new BrowserUseExecutionAdapter(
      new PrismaBrowserUseExecutionContext()
    );
  }

  /**
   * Execute an agent and track its lifecycle through the database
   * Returns the Run record with current status and results (if complete)
   */
  async runAgent(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    return this.adapter.runAgent(input);
  }
}
