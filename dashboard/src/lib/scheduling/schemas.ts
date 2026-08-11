import { z } from 'zod';

import { isValidTimezone } from './recurrence';
import { variableValuesSchema } from '@/lib/variables/schemas';

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimezone, 'Timezone must be a valid IANA timezone.');
const weekdays = z.array(z.number().int().min(1).max(7)).max(7);

export const scheduleIdSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export const createScheduleSchema = z
  .object({
    agentId: z.string().trim().min(1).max(128),
    kind: z.enum(['ONCE', 'DAILY', 'WEEKLY']),
    timezone,
    localTime: localTime.optional(),
    weekdays: weekdays.optional(),
    oneTimeAt: z.coerce.date().optional(),
    variables: variableValuesSchema.optional().default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'ONCE' && !value.oneTimeAt)
      context.addIssue({
        code: 'custom',
        path: ['oneTimeAt'],
        message: 'oneTimeAt is required.',
      });
    if (value.kind !== 'ONCE' && !value.localTime)
      context.addIssue({
        code: 'custom',
        path: ['localTime'],
        message: 'localTime is required.',
      });
    if (value.kind === 'WEEKLY' && !value.weekdays?.length)
      context.addIssue({
        code: 'custom',
        path: ['weekdays'],
        message: 'Select at least one weekday.',
      });
  });

export const updateScheduleSchema = z
  .object({
    kind: z.enum(['ONCE', 'DAILY', 'WEEKLY']).optional(),
    timezone: timezone.optional(),
    localTime: localTime.nullable().optional(),
    weekdays: weekdays.optional(),
    oneTimeAt: z.coerce.date().nullable().optional(),
    version: z.number().int().positive().optional(),
    variables: variableValuesSchema.optional(),
  })
  .strict();

export const occurrencePaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(128).optional(),
});
