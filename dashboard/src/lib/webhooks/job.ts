import { z } from 'zod';

export const webhookDeliveryJobSchema = z
  .object({ version: z.literal(1), deliveryId: z.string().min(1).max(128) })
  .strict();

export type WebhookDeliveryJob = z.infer<typeof webhookDeliveryJobSchema>;

export function webhookDeliveryJob(deliveryId: string): WebhookDeliveryJob {
  return { version: 1, deliveryId };
}
