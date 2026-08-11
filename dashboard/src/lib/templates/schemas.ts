import { z } from 'zod';

export const templateIdSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,64}$/),
});

export const createFromTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    goal: z.string().trim().min(1).max(1500),
    targetWebsite: z
      .string()
      .trim()
      .url()
      .refine(
        (value) => /^https?:\/\//i.test(value),
        'Website must use HTTP or HTTPS.'
      ),
    createAndTest: z.boolean().default(false),
  })
  .strict();
