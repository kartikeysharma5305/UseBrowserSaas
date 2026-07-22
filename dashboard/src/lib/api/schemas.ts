import { z } from 'zod';

const agentConfigurationSchema = z.object({
  model: z.string().trim().min(1),
  maxSteps: z.number().int().min(1).max(200).default(25),
  timeoutMs: z.number().int().min(1000).max(120000).default(60000),
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
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'targetWebsite must use http or https.',
  });

export const agentIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  goal: z.string().trim().min(1).max(1500),
  targetWebsite: targetWebsiteSchema,
  status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
  scheduleType: z.enum(['MANUAL', 'DAILY', 'WEEKLY']).default('MANUAL'),
  scheduleConfig: z.record(z.string(), z.any()).default({}),
  configuration: agentConfigurationSchema.default({
    model: 'gpt-4o-mini',
    maxSteps: 25,
    timeoutMs: 60000,
    browserSettings: {
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
    },
  }),
});

export const updateAgentSchema = createAgentSchema.partial();
