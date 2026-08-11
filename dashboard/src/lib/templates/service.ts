import type { PlanCode } from '@prisma/client';

import { createOwnedAgent } from '@/lib/agents/service';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_GROQ_MODEL } from '@/lib/execution/groq-models';
import { PrismaAgentExecutionService } from '@/lib/execution/prisma-agent-execution-service';
import { getPlan } from '@/lib/plans/catalogue';

import {
  AGENT_TEMPLATES,
  getAgentTemplate,
  TEMPLATE_CATALOGUE_VERSION,
  type AgentTemplate,
} from './catalogue';

export class TemplateNotFoundError extends Error {}

function recommendation(template: AgentTemplate, planCode: PlanCode) {
  const plan = getPlan(planCode);
  const maxSteps = Math.min(
    template.recommendedMaxSteps,
    plan.limits.maxStepsPerRun
  );
  const timeoutMs = Math.min(
    template.recommendedTimeoutMs,
    plan.limits.maxRunDurationMs
  );
  return {
    maxSteps,
    timeoutMs,
    adjusted:
      maxSteps !== template.recommendedMaxSteps ||
      timeoutMs !== template.recommendedTimeoutMs,
  };
}

export function toPublicTemplate(template: AgentTemplate, planCode: PlanCode) {
  return {
    ...template,
    appliedRecommendation: recommendation(template, planCode),
  };
}

export function listTemplatesForPlan(planCode: PlanCode) {
  return {
    catalogueVersion: TEMPLATE_CATALOGUE_VERSION,
    templates: AGENT_TEMPLATES.map((template) =>
      toPublicTemplate(template, planCode)
    ),
  };
}

export function getTemplateForPlan(id: string, planCode: PlanCode) {
  const template = getAgentTemplate(id);
  if (!template) throw new TemplateNotFoundError();
  return toPublicTemplate(template, planCode);
}

export async function createAgentFromTemplate(
  user: { id: string; planCode: PlanCode },
  templateId: string,
  input: {
    name: string;
    description?: string;
    goal: string;
    targetWebsite: string;
    createAndTest: boolean;
  },
  execution = new PrismaAgentExecutionService()
) {
  const template = getAgentTemplate(templateId);
  if (!template) throw new TemplateNotFoundError();
  const applied = recommendation(template, user.planCode);
  const variables = (template.variables ?? []).map((variable) => ({
    ...variable,
    ...(variable.key === 'website'
      ? { defaultValue: input.targetWebsite }
      : {}),
  }));
  const agent = await createOwnedAgent(user.id, {
    name: input.name,
    description: input.description || template.description,
    goal: input.goal,
    targetWebsite: variables.some((variable) => variable.key === 'website')
      ? '{{website}}'
      : input.targetWebsite,
    status: 'ACTIVE',
    scheduleType: 'MANUAL',
    scheduleConfig: {},
    configuration: {
      model: DEFAULT_GROQ_MODEL.id,
      maxSteps: applied.maxSteps,
      timeoutMs: applied.timeoutMs,
      browserSettings: {
        headless: true,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
      templateProvenance: { id: template.id, version: template.version },
    },
    variables,
    outputSchema: template.outputSchema,
  });
  await prisma.onboardingState.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      visible: false,
      selectedTemplateId: template.id,
    },
    update: { selectedTemplateId: template.id },
  });
  if (!input.createAndTest)
    return { agent, run: null, runAdmissionError: null, applied };
  try {
    const run = await execution.runAgent({
      agentId: agent.id,
      userId: user.id,
    });
    return { agent, run, runAdmissionError: null, applied };
  } catch {
    return {
      agent,
      run: null,
      runAdmissionError:
        'The Agent was created, but its first Run could not be queued. You can retry from Agent details.',
      applied,
    };
  }
}
