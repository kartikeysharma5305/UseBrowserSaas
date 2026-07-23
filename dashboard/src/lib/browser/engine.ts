import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';
import { AgentEventType } from '@prisma/client';

export interface BrowserExecutionInput {
  agentId: string;
  userId: string;
  task: string;
  configuration: {
    model: string;
    maxSteps: number;
    timeoutMs: number;
    browserSettings: {
      headless: boolean;
      viewportWidth: number;
      viewportHeight: number;
    };
  };
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

export interface BrowserExecutionResult {
  runId: string;
  status: 'completed' | 'failed';
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

function resolveRepoDist(relativePath: string): string {
  const root = path.resolve(
    path.dirname(process.argv[1] ?? process.cwd()),
    '..'
  );
  return path.join(root, 'dist', relativePath);
}

async function loadAgentModule() {
  const modulePath = resolveRepoDist('agent/index.js');
  return import(modulePath);
}

async function loadBrowserModule() {
  const modulePath = resolveRepoDist('browser/index.js');
  return import(modulePath);
}

async function loadLlmModelsModule() {
  const modulePath = resolveRepoDist('llm/models.js');
  return import(modulePath);
}

async function loadLlmBaseModule() {
  const modulePath = resolveRepoDist('llm/base.js');
  return import(modulePath);
}

function ensureDir(target: string) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
}

function resolveArtifactsDir(): string {
  const candidate = path.join(process.cwd(), 'browseruse_agent_data');
  ensureDir(candidate);
  ensureDir(path.join(candidate, 'screenshots'));
  return candidate;
}

function copyScreenshotToArtifacts(
  artifactsDir: string,
  runId: string,
  stepNumber: number | null,
  sourcePath: string | null
): { persistedPath: string | null; base64: string | null } {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { persistedPath: null, base64: null };
  }

  const extension = path.extname(sourcePath).toLowerCase();
  const runDir = path.join(artifactsDir, 'screenshots', runId);
  ensureDir(runDir);

  const suffix = stepNumber != null ? `_step_${stepNumber}` : '';
  const filename = `${new Date().toISOString().replace(/:/g, '-')}${suffix}${extension}`;
  const persistedPath = path.join(runDir, filename);

  try {
    fs.copyFileSync(sourcePath, persistedPath);
  } catch {
    return { persistedPath: null, base64: null };
  }

  let base64: string | null = null;
  try {
    const buffer = fs.readFileSync(persistedPath);
    base64 = buffer.toString('base64');
  } catch {
    base64 = null;
  }

  return { persistedPath, base64 };
}

export class BrowserExecutionService {
  async execute(input: BrowserExecutionInput): Promise<BrowserExecutionResult> {
    const startedAt = new Date();
    const runId = randomUUID();
    const artifactsDir = resolveArtifactsDir();
    const events: ExecutionEvent[] = [];
    const screenshots: ExecutionScreenshot[] = [];
    const visitedUrls: string[] = [];

    await prisma.run.create({
      data: {
        agentId: input.agentId,
        status: 'RUNNING',
        startedAt,
      },
    });

    await prisma.agentEvent.create({
      data: {
        runId,
        type: AgentEventType.RUN_STARTED,
        message: 'Browser execution started.',
      },
    });

    let AgentClass: any;
    let BrowserProfileClass: any;
    let BrowserSessionClass: any;
    let getLlmByName: (modelName: string) => any;
    let BaseChatModel: any;

    try {
      const [agentModule, browserModule, llmModelsModule, llmBaseModule] =
        await Promise.all([
          loadAgentModule(),
          loadBrowserModule(),
          loadLlmModelsModule(),
          loadLlmBaseModule(),
        ]);

      AgentClass = agentModule.Agent;
      BrowserProfileClass = browserModule.BrowserProfile;
      BrowserSessionClass = browserModule.BrowserSession;
      getLlmByName = llmModelsModule.getLlmByName;
      BaseChatModel = llmBaseModule.BaseChatModel;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model name';
      await this._failRun(runId, startedAt, message);
      throw error;
    }

    let llm: any;
    try {
      llm = getLlmByName(input.configuration.model);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model name';
      await this._failRun(runId, startedAt, message);
      throw error;
    }

    const browserProfile = new BrowserProfileClass({
      headless: input.configuration.browserSettings.headless,
      viewport: {
        width: input.configuration.browserSettings.viewportWidth,
        height: input.configuration.browserSettings.viewportHeight,
      },
    });

    const browserSession = new BrowserSessionClass({
      browser_profile: browserProfile,
    });

    const capturedEvents: Array<{
      event: unknown;
      timestamp: Date;
    }> = [];

    const agent = new AgentClass({
      task: input.task,
      llm,
      browser_profile: browserProfile,
      source: 'dashboard',
    });

    agent.eventbus.on('CreateAgentStepEvent', (event: unknown) => {
      capturedEvents.push({ event, timestamp: new Date() });
    });

    agent.eventbus.on('CreateAgentTaskEvent', (event: unknown) => {
      capturedEvents.push({ event, timestamp: new Date() });
    });

    agent.eventbus.on('UpdateAgentTaskEvent', (event: unknown) => {
      capturedEvents.push({ event, timestamp: new Date() });
    });

    let history: Awaited<ReturnType<typeof AgentClass.prototype.run>> | null =
      null;
    let runError: string | null = null;

    try {
      history = await agent.run(input.configuration.maxSteps);
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
      await this._failRun(runId, startedAt, runError);
    } finally {
      try {
        await browserSession.close();
      } catch {
        // Best-effort cleanup
      }
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    if (history) {
      visitedUrls.push(...(history.urls().filter(Boolean) as string[]));
    }

    for (const captured of capturedEvents) {
      const rawEvent = captured.event as Record<string, unknown>;

      if (
        rawEvent.event_type === 'CreateAgentStepEvent' ||
        rawEvent.constructor?.name === 'CreateAgentStepEvent'
      ) {
        const stepEvent = rawEvent as {
          step?: number;
          evaluation_previous_goal?: string;
          memory?: string;
          next_goal?: string;
          actions?: unknown[];
          screenshot_url?: string | null;
          url?: string;
        };

        const stepNumber =
          typeof stepEvent.step === 'number' ? stepEvent.step : null;

        let persistedScreenshot: {
          persistedPath: string | null;
          base64: string | null;
        } = { persistedPath: null, base64: null };

        if (typeof stepEvent.screenshot_url === 'string') {
          const dataUrl = stepEvent.screenshot_url;
          if (dataUrl.startsWith('data:image')) {
            const base64Data = dataUrl.split(',')[1];
            if (base64Data) {
              const runDir = path.join(artifactsDir, 'screenshots', runId);
              ensureDir(runDir);
              const filename =
                stepNumber != null
                  ? `step_${stepNumber}.png`
                  : `step_${Date.now()}.png`;
              const persistedPath = path.join(runDir, filename);
              try {
                fs.writeFileSync(
                  persistedPath,
                  Buffer.from(base64Data, 'base64')
                );
                persistedScreenshot = {
                  persistedPath,
                  base64: base64Data,
                };
              } catch {
                persistedScreenshot = { persistedPath: null, base64: null };
              }
            }
          } else if (dataUrl && fs.existsSync(dataUrl)) {
            persistedScreenshot = copyScreenshotToArtifacts(
              artifactsDir,
              runId,
              stepNumber,
              dataUrl
            );
          }
        }

        screenshots.push({
          stepNumber,
          path: persistedScreenshot.persistedPath,
          base64: persistedScreenshot.base64,
        });

        events.push({
          type: 'step',
          message:
            (typeof stepEvent.evaluation_previous_goal === 'string'
              ? stepEvent.evaluation_previous_goal
              : '') || 'Step executed',
          data: {
            step: stepEvent.step,
            memory: stepEvent.memory,
            next_goal: stepEvent.next_goal,
            actions: stepEvent.actions,
            url: stepEvent.url,
          },
          timestamp: captured.timestamp,
        });
      } else if (
        rawEvent.event_type === 'CreateAgentTaskEvent' ||
        rawEvent.constructor?.name === 'CreateAgentTaskEvent'
      ) {
        events.push({
          type: 'task',
          message: 'Task started',
          data: {
            task: (rawEvent as Record<string, unknown>).task,
            llm_model: (rawEvent as Record<string, unknown>).llm_model,
          },
          timestamp: captured.timestamp,
        });
      } else if (
        rawEvent.event_type === 'UpdateAgentTaskEvent' ||
        rawEvent.constructor?.name === 'UpdateAgentTaskEvent'
      ) {
        const updateEvent = rawEvent as {
          stopped?: boolean;
          paused?: boolean;
          done_output?: string | null;
        };
        events.push({
          type: 'update',
          message: updateEvent.done_output
            ? `Task finished: ${String(updateEvent.done_output).slice(0, 200)}`
            : updateEvent.stopped
              ? 'Task stopped'
              : 'Task updated',
          data: {
            stopped: updateEvent.stopped,
            paused: updateEvent.paused,
            done_output: updateEvent.done_output,
          },
          timestamp: captured.timestamp,
        });
      }
    }

    const finalResult = history ? history.final_result() : null;
    const isSuccessful = history ? history.is_successful() : null;
    const finalStatus: 'completed' | 'failed' = runError
      ? 'failed'
      : isSuccessful === true
        ? 'completed'
        : isSuccessful === false
          ? 'failed'
          : runError
            ? 'failed'
            : 'completed';

    if (finalStatus === 'completed') {
      await prisma.run.update({
        where: { id: runId },
        data: {
          status: 'SUCCESS',
          completedAt,
          duration: durationMs,
          result: {
            summary: finalResult,
            visitedUrls,
          },
        },
      });
    } else {
      await this._failRun(
        runId,
        startedAt,
        runError ?? 'Execution unsuccessful'
      );
    }

    for (const capturedEvent of events) {
      await prisma.agentEvent.create({
        data: {
          runId,
          type:
            capturedEvent.type === 'step'
              ? AgentEventType.STEP_COMPLETED
              : capturedEvent.type === 'task'
                ? AgentEventType.STEP_STARTED
                : AgentEventType.RUN_COMPLETED,
          message: capturedEvent.message,
          timestamp: capturedEvent.timestamp,
        },
      });
    }

    await prisma.agentEvent.create({
      data: {
        runId,
        type:
          finalStatus === 'completed'
            ? AgentEventType.RUN_COMPLETED
            : AgentEventType.RUN_FAILED,
        message:
          finalStatus === 'completed'
            ? `Run completed in ${durationMs} ms.`
            : `Run failed: ${runError ?? 'Unknown error'}`,
      },
    });

    return {
      runId,
      status: finalStatus,
      startedAt,
      completedAt,
      durationMs,
      result: finalResult,
      errorMessage: runError,
      events,
      screenshots,
      visitedUrls,
      rawOutput: history?.toJSON?.(null) ?? null,
    };
  }

  private async _failRun(runId: string, startedAt: Date, errorMessage: string) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        completedAt,
        duration: durationMs,
        errorMessage,
      },
    });

    await prisma.agentEvent.create({
      data: {
        runId,
        type: AgentEventType.RUN_FAILED,
        message: errorMessage,
      },
    });
  }
}
