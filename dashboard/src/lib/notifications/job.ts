import { z } from 'zod';

export const notificationDeliveryJobSchema = z
  .object({ version: z.literal(1), deliveryId: z.string().min(1).max(128) })
  .strict();

export type NotificationDeliveryJob = z.infer<
  typeof notificationDeliveryJobSchema
>;

export function notificationDeliveryJob(
  deliveryId: string
): NotificationDeliveryJob {
  return { version: 1, deliveryId };
}
