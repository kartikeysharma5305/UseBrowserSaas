import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import type { AgentVariableDefinitionInput } from '@/lib/variables/schemas';
import {
  detectedPlaceholders,
  resolveAgentInput,
  VariableResolutionError,
} from '@/lib/variables/resolver';
import {
  normalizeSafetyPolicy,
  safetyPolicyInput,
} from '@/lib/execution-safety/policy';
import { normalizeOutputSchema } from '@/lib/structured-results';

export interface CreateOwnedAgentInput {
  name: string;
  description?: string | null;
  goal: string;
  targetWebsite: string;
  status: 'ACTIVE' | 'PAUSED';
  scheduleType: 'MANUAL' | 'DAILY' | 'WEEKLY';
  scheduleConfig: Prisma.InputJsonValue;
  configuration: Prisma.InputJsonValue;
  variables?: AgentVariableDefinitionInput[];
  safetyPolicy?: Prisma.JsonValue | Record<string, unknown>;
  outputSchema?: unknown;
}

export function createOwnedAgent(userId: string, input: CreateOwnedAgentInput) {
  const { variables = [], safetyPolicy, outputSchema, ...agent } = input;
  const declared = new Set(variables.map((variable) => variable.key));
  const undeclared = detectedPlaceholders(agent.goal, agent.targetWebsite).find(
    (key) => !declared.has(key)
  );
  if (undeclared)
    throw new VariableResolutionError(
      'UNDECLARED_PLACEHOLDER',
      `Declare the ${undeclared} variable before saving.`
    );
  return prisma.agent.create({
    data: {
      userId,
      ...agent,
      safetyPolicy: safetyPolicyInput(
        normalizeSafetyPolicy(safetyPolicy ?? null, agent.targetWebsite)
      ),
      outputSchema: normalizeOutputSchema(
        outputSchema
      ) as unknown as Prisma.InputJsonValue,
      variables: {
        create: variables.map((variable) => ({
          ...variable,
          description: variable.description ?? null,
          defaultValue: variable.defaultValue ?? null,
          constraints: variable.constraints as Prisma.InputJsonValue,
        })),
      },
    },
    include: { variables: { orderBy: { displayOrder: 'asc' } } },
  });
}

export async function getOwnedAgentWithVariables(
  userId: string,
  agentId: string
) {
  return prisma.agent.findFirst({
    where: { id: agentId, userId },
    include: { variables: { orderBy: { displayOrder: 'asc' } } },
  });
}

export async function replaceOwnedAgentVariables(
  userId: string,
  agentId: string,
  variables: AgentVariableDefinitionInput[]
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent:${agentId}`}, 0))`;
    const agent = await transaction.agent.findFirst({
      where: { id: agentId, userId },
      select: {
        id: true,
        goal: true,
        targetWebsite: true,
        variableVersion: true,
      },
    });
    if (!agent) return null;
    const declared = new Set(variables.map((variable) => variable.key));
    const undeclared = detectedPlaceholders(
      agent.goal,
      agent.targetWebsite
    ).find((key) => !declared.has(key));
    if (undeclared)
      throw new VariableResolutionError(
        'UNDECLARED_PLACEHOLDER',
        `Declare the ${undeclared} variable before saving.`
      );
    await transaction.agentVariable.deleteMany({ where: { agentId } });
    if (variables.length)
      await transaction.agentVariable.createMany({
        data: variables.map((variable) => ({
          agentId,
          ...variable,
          description: variable.description ?? null,
          defaultValue: variable.defaultValue ?? null,
          constraints: variable.constraints as Prisma.InputJsonValue,
        })),
      });
    const updated = await transaction.agent.update({
      where: { id: agentId },
      data: { variableVersion: { increment: 1 } },
      include: { variables: { orderBy: { displayOrder: 'asc' } } },
    });
    const schedules = await transaction.schedule.findMany({
      where: { agentId },
      select: { id: true, variableValues: true, nextRunAt: true },
    });
    for (const schedule of schedules) {
      try {
        resolveAgentInput({
          goal: updated.goal,
          targetWebsite: updated.targetWebsite,
          definitions: updated.variables,
          supplied: schedule.variableValues as Record<
            string,
            string | number | boolean
          >,
          definitionVersion: updated.variableVersion,
        });
        await transaction.schedule.update({
          where: { id: schedule.id },
          data: {
            configurationErrorCode: null,
            variableVersion: updated.variableVersion,
          },
        });
      } catch {
        if (schedule.nextRunAt)
          await transaction.scheduledOccurrence.createMany({
            data: [
              {
                scheduleId: schedule.id,
                scheduledFor: schedule.nextRunAt,
                status: 'AGENT_BLOCKED',
                resolvedAt: new Date(),
                errorCode: 'VARIABLE_CONFIGURATION_INVALID',
              },
            ],
            skipDuplicates: true,
          });
        await transaction.schedule.update({
          where: { id: schedule.id },
          data: {
            state: 'PAUSED',
            configurationErrorCode: 'VARIABLE_CONFIGURATION_INVALID',
            version: { increment: 1 },
          },
        });
      }
    }
    return updated;
  });
}
