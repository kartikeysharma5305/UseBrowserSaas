import { z } from 'zod';

import { DEFAULT_GROQ_MODEL } from '@/lib/execution/groq-models';
import { isSupportedExecutionModelId } from '@/lib/execution/model-catalogue';
import { sanitizeCancellationReason } from '@/lib/runs/cancellation-types';
import { agentVariablesSchema } from '@/lib/variables/schemas';
import { canonicalizeDomain } from '@/lib/execution-safety/domain-policy';
import { normalizeOutputSchema } from '@/lib/structured-results';

export const outputSchemaInputSchema = z
  .unknown()
  .transform((value, context) => {
    try {
      return normalizeOutputSchema(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message:
          error instanceof Error ? error.message : 'Output schema is invalid.',
      });
      return z.NEVER;
    }
  });

const agentConfigurationSchema = z.object({
  model: z.string().trim().min(1).refine(isSupportedExecutionModelId, {
    message: 'Select a currently supported AI model.',
  }),
  maxSteps: z.number().int().min(1).max(200).default(25),
  timeoutMs: z.number().int().min(5000).max(900000).default(60000),
  browserSettings: z
    .object({
      headless: z.boolean().default(true),
      viewportWidth: z.number().int().min(320).max(1920).default(1280),
      viewportHeight: z.number().int().min(320).max(1080).default(720),
    })
    .default({
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
    }),
});

const targetWebsiteSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (/^{{\s*[a-z][a-z0-9_]{0,47}\s*}}$/.test(value)) return true;
    try {
      const candidate = value.replace(
        /{{\s*[a-z][a-z0-9_]{0,47}\s*}}/g,
        'value'
      );
      return /^https?:\/\//i.test(candidate) && Boolean(new URL(candidate));
    } catch {
      return false;
    }
  }, 'targetWebsite must resolve to an HTTP(S) URL.');

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value, context) => {
    try {
      return canonicalizeDomain(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid domain.',
      });
      return z.NEVER;
    }
  });

export const executionSafetyPolicySchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    allowedDomains: z.array(domainSchema).max(32).default([]),
    blockedDomains: z.array(domainSchema).max(32).default([]),
    allowSubdomains: z.boolean().default(false),
    redirectPolicy: z
      .enum(['SAME_DOMAIN', 'ALLOWED_DOMAINS'])
      .default('SAME_DOMAIN'),
    allowDownloads: z.literal(false).default(false),
    allowUploads: z.literal(false).default(false),
    formSubmissionMode: z
      .enum(['BLOCKED', 'SAFE_ONLY', 'ALLOWED'])
      .default('SAFE_ONLY'),
    allowDestructiveActions: z.boolean().default(false),
    maxNavigations: z.number().int().min(1).max(100).default(20),
    maxPages: z.number().int().min(1).max(10).default(3),
    sensitiveDomainMode: z.enum(['BLOCK', 'ALLOW']).default('BLOCK'),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed = new Set(value.allowedDomains);
    if (allowed.size !== value.allowedDomains.length)
      context.addIssue({
        code: 'custom',
        path: ['allowedDomains'],
        message: 'Duplicate domains are not allowed.',
      });
    const blocked = new Set(value.blockedDomains);
    if (blocked.size !== value.blockedDomains.length)
      context.addIssue({
        code: 'custom',
        path: ['blockedDomains'],
        message: 'Duplicate domains are not allowed.',
      });
    for (const domain of blocked)
      if (allowed.has(domain))
        context.addIssue({
          code: 'custom',
          path: ['blockedDomains'],
          message: 'A domain cannot be both allowed and blocked.',
        });
  });

export const agentIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const runIdSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export const artifactIdSchema = z.object({
  artifactId: z.string().trim().min(1).max(128),
});

export const cancelRunSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(240, 'Cancellation reason must be 240 characters or fewer.')
      .transform(sanitizeCancellationReason)
      .optional(),
  })
  .default({});

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional().nullable(),
    goal: z.string().trim().min(1).max(1500),
    targetWebsite: targetWebsiteSchema,
    status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
    scheduleType: z.enum(['MANUAL', 'DAILY', 'WEEKLY']).default('MANUAL'),
    scheduleConfig: z.record(z.string(), z.any()).default({}),
    configuration: agentConfigurationSchema.default({
      model: DEFAULT_GROQ_MODEL.id,
      maxSteps: 25,
      timeoutMs: 60000,
      browserSettings: {
        headless: true,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    }),
    variables: agentVariablesSchema.default([]),
    safetyPolicy: executionSafetyPolicySchema.optional(),
    outputSchema: outputSchemaInputSchema.optional().nullable(),
  })
  .strict();

export const updateAgentSchema = createAgentSchema.partial();
