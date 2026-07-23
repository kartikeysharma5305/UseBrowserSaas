import { AgentEventType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { BrowserExecutionService } from '@/lib/browser/engine';

import type { AgentExecutionInput, AgentExecutionResult } from './types';

export class PrismaAgentExecutionService {
  private readonly browserExecutionService: BrowserExecutionService;

  constructor() {
    this.browserExecutionService = new BrowserExecutionService();
  }

  async runAgent(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
    });

    if (!agent) {
      throw new Error('Agent not found.');
    }

    const task = `${agent.goal} Navigate to ${agent.targetWebsite}.`;
    const configuration =
      (agent.configuration as {
        model?: string;
        maxSteps?: number;
        timeoutMs?: number;
        browserSettings?: {
          headless?: boolean;
          viewportWidth?: number;
          viewportHeight?: number;
        };
      }) ?? {};

    const model = configuration.model || 'gpt-4o-mini';
    const maxSteps = configuration.maxSteps ?? 25;
    const timeoutMs = configuration.timeoutMs ?? 60000;
    const browserSettings = configuration.browserSettings ?? {
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
    };

    return this.browserExecutionService.execute({
      agentId: input.agentId,
      userId: input.userId,
      task,
      configuration: {
        model,
        maxSteps,
        timeoutMs,
        browserSettings: {
          headless: browserSettings.headless ?? true,
          viewportWidth: browserSettings.viewportWidth ?? 1280,
          viewportHeight: browserSettings.viewportHeight ?? 720,
        },
      },
    });
  }
}
