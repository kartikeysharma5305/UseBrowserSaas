import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from './types';

const eventTypes = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length)
  .refine((items) => new Set(items).size === items.length, {
    message: 'Duplicate event types are not allowed.',
  });

export const createWebhookEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().min(1).max(2_048),
    eventTypes,
  })
  .strict();

export const updateWebhookEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    url: z.string().trim().min(1).max(2_048).optional(),
    eventTypes: eventTypes.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied.');

export const webhookIdSchema = z.string().trim().min(1).max(128);
export const webhookDeliveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
