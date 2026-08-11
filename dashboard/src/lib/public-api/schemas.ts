import { z } from 'zod';
import { API_KEY_SCOPES } from './scopes';
import { variableValuesSchema } from '@/lib/variables/schemas';

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1)
      .max(API_KEY_SCOPES.length)
      .refine(
        (items) => new Set(items).size === items.length,
        'Duplicate scopes are not allowed.'
      ),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .transform((value, context) => {
    const expiresAt = value.expiresAt ? new Date(value.expiresAt) : null;
    if (
      expiresAt &&
      (expiresAt <= new Date() ||
        expiresAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must be within the next year.',
      });
      return z.NEVER;
    }
    return { ...value, expiresAt };
  });

export const apiKeyIdSchema = z.string().trim().min(1).max(128);
export const createPublicRunSchema = z
  .object({ variables: variableValuesSchema.optional().default({}) })
  .strict();
export const publicCancelSchema = z
  .object({ reason: z.string().trim().max(240).optional() })
  .strict()
  .default({});

export const publicListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(512).optional(),
  status: z.string().trim().max(32).optional(),
  agentId: z.string().trim().max(128).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
});

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
