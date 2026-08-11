import { z } from 'zod';

import { isValidTimezone } from '@/lib/scheduling/recurrence';

export const notificationPreferenceSchema = z
  .object({
    emailEnabled: z.boolean().optional(),
    runSuccess: z.boolean().optional(),
    runFailure: z.boolean().optional(),
    runCanceled: z.boolean().optional(),
    scheduledAlerts: z.boolean().optional(),
    billingAlerts: z.boolean().optional(),
    usageAlerts: z.boolean().optional(),
    accountLifecycle: z.boolean().optional(),
    dailyDigest: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimezone, 'Timezone must be a valid IANA timezone.')
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one preference is required.'
  );

export const notificationPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(128).optional(),
});

export const notificationIdSchema = z.object({
  id: z.string().trim().min(1).max(128),
});
