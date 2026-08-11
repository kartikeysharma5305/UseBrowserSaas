import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { publicSnapshot } from '@/lib/variables/resolver';
import { LEGAL_DOCUMENT_VERSIONS } from '@/lib/legal/config';

export const DATA_EXPORT_VERSION = 1 as const;
export const DATA_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
const LIMITS = {
  agents: 500,
  runs: 5_000,
  schedules: 1_000,
  usage: 10_000,
  notifications: 5_000,
  apiKeys: 500,
  webhooks: 500,
  feedback: 1_000,
} as const;

type Database = PrismaClient;

export class DataExportUnavailableError extends Error {}
export class DataExportTooLargeError extends Error {}

export async function createUserDataExport(
  userId: string,
  options: { now?: Date; database?: Database } = {}
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const deletion = await database.accountDeletion.findUnique({
    where: { userId },
    select: { status: true, stage: true, requestedAt: true },
  });
  if (deletion) throw new DataExportUnavailableError();

  const [
    user,
    agents,
    runs,
    schedules,
    usage,
    notifications,
    apiKeys,
    webhooks,
    acceptance,
    feedback,
  ] = await Promise.all([
    database.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        image: true,
        planCode: true,
        planSource: true,
        betaAccessStatus: true,
        betaActivatedAt: true,
        betaEndedAt: true,
        createdAt: true,
        updatedAt: true,
        notificationPreference: true,
        onboardingState: true,
        subscription: {
          select: {
            status: true,
            cancelAtPeriodEnd: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            canceledAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    database.agent.findMany({
      where: { userId },
      take: LIMITS.agents,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        goal: true,
        targetWebsite: true,
        status: true,
        configuration: true,
        safetyPolicy: true,
        outputSchema: true,
        createdAt: true,
        updatedAt: true,
        variables: {
          orderBy: { displayOrder: 'asc' },
          select: {
            key: true,
            label: true,
            description: true,
            type: true,
            required: true,
            defaultValue: true,
            constraints: true,
            displayOrder: true,
          },
        },
      },
    }),
    database.run.findMany({
      where: { agent: { userId } },
      take: LIMITS.runs,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        agentId: true,
        status: true,
        source: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        duration: true,
        attempt: true,
        lastFailureCode: true,
        result: true,
        structuredResult: true,
        structuredStatus: true,
        inputSnapshot: true,
        createdAt: true,
        events: {
          orderBy: { sequence: 'asc' },
          select: {
            sequence: true,
            type: true,
            message: true,
            data: true,
            timestamp: true,
          },
        },
        artifacts: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            fileName: true,
            mimeType: true,
            size: true,
            checksum: true,
            createdAt: true,
          },
        },
      },
    }),
    database.schedule.findMany({
      where: { userId },
      take: LIMITS.schedules,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        agentId: true,
        kind: true,
        timezone: true,
        localTime: true,
        weekdays: true,
        oneTimeAt: true,
        state: true,
        nextRunAt: true,
        lastTriggeredOccurrenceAt: true,
        createdAt: true,
        updatedAt: true,
        occurrences: {
          orderBy: { scheduledFor: 'asc' },
          take: 5_000,
          select: {
            id: true,
            scheduledFor: true,
            status: true,
            runId: true,
            discoveredAt: true,
            resolvedAt: true,
            errorCode: true,
          },
        },
      },
    }),
    database.usageRecord.findMany({
      where: { userId },
      take: LIMITS.usage,
      orderBy: { recordedAt: 'asc' },
      select: {
        id: true,
        runId: true,
        attempt: true,
        type: true,
        quantity: true,
        unit: true,
        measurement: true,
        recordedAt: true,
        periodStart: true,
        periodEnd: true,
      },
    }),
    database.notification.findMany({
      where: { userId },
      take: LIMITS.notifications,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        title: true,
        payload: true,
        runId: true,
        scheduleId: true,
        createdAt: true,
        readAt: true,
        deliveries: {
          select: {
            channel: true,
            status: true,
            attemptCount: true,
            failureCode: true,
            createdAt: true,
            sentAt: true,
          },
        },
      },
    }),
    database.apiKey.findMany({
      where: { userId },
      take: LIMITS.apiKeys,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    }),
    database.webhookEndpoint.findMany({
      where: { userId },
      take: LIMITS.webhooks,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        url: true,
        status: true,
        eventTypes: true,
        secretPrefix: true,
        createdAt: true,
        updatedAt: true,
        deliveries: {
          take: 5_000,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            attemptCount: true,
            firstAttemptAt: true,
            lastAttemptAt: true,
            deliveredAt: true,
            httpStatus: true,
            failureCode: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    }),
    database.legalDocumentAcceptance.findMany({
      where: { userId },
      select: {
        documentType: true,
        documentVersion: true,
        acceptedAt: true,
      },
      orderBy: { acceptedAt: 'asc' },
    }),
    database.betaFeedback.findMany({
      where: { userId },
      take: LIMITS.feedback,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        runId: true,
        category: true,
        message: true,
        contextPath: true,
        status: true,
        releaseVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const exportData = {
    manifest: {
      exportVersion: DATA_EXPORT_VERSION,
      userId,
      generatedAt: now.toISOString(),
      applicationVersion: '0.8.0',
      legalDocumentVersions: LEGAL_DOCUMENT_VERSIONS,
      categoriesIncluded: [
        'profile',
        'agents',
        'runs-events-results-artifact-manifest',
        'schedules',
        'usage',
        'notifications',
        'api-key-metadata',
        'webhook-metadata',
        'billing-entitlement',
        'legal-acceptance',
        'beta-feedback',
      ],
      categoriesExcluded: [
        'passwords-and-auth-accounts',
        'sessions-and-cookies',
        'api-key-plaintext-and-hashes',
        'webhook-encrypted-signing-material',
        'storage-object-keys',
        'provider-and-server-secrets',
        'worker-queue-and-internal-operations',
        'artifact-file-content',
      ],
      limits: LIMITS,
    },
    profile: user,
    agents: agents.map((agent) => ({
      ...agent,
      variables: agent.variables.map((variable) => ({
        ...variable,
        defaultValue: variable.type === 'SECRET' ? null : variable.defaultValue,
      })),
    })),
    runs: runs.map((run) => ({
      ...run,
      inputSnapshot: publicSnapshot(run.inputSnapshot),
      artifacts: run.artifacts.map((artifact) => ({
        ...artifact,
        downloadPath: `/api/runs/${run.id}/artifacts/${artifact.id}`,
      })),
    })),
    schedules,
    usage: usage.map((record) => ({
      ...record,
      quantity: record.quantity.toString(),
    })),
    notifications,
    apiKeys,
    webhooks,
    legalAcceptance: acceptance,
    betaFeedback: feedback,
  };
  const json = `${JSON.stringify(exportData, null, 2)}\n`;
  if (Buffer.byteLength(json, 'utf8') > DATA_EXPORT_MAX_BYTES)
    throw new DataExportTooLargeError();
  return { data: exportData, json };
}
