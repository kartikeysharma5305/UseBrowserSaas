import { z } from 'zod';

export const browserRunJobSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1).max(128),
  })
  .strict();

export type BrowserRunJob = z.infer<typeof browserRunJobSchema>;

export function browserRunJob(runId: string): BrowserRunJob {
  return { version: 1, runId };
}
