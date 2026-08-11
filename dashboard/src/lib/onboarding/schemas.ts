import { z } from 'zod';

export const updateOnboardingSchema = z
  .object({ action: z.enum(['DISMISS', 'REOPEN']) })
  .strict();
