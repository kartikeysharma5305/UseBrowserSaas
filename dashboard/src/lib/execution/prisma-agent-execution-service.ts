import { PrismaRunProducer, type EnqueuedRun } from '@/lib/queue/run-producer';

import type { AgentExecutionInput } from './types';
import { toExecutionServiceError } from './errors';
import { recordAdmissionRejection } from '@/lib/operations/signals';

/**
 * Compatibility facade for internal callers. Submission is always durable and
 * never imports or launches the browser engine in the request process.
 */
export class PrismaAgentExecutionService {
  constructor(private readonly producer = new PrismaRunProducer()) {}

  async runAgent(input: AgentExecutionInput): Promise<EnqueuedRun> {
    try {
      return await this.producer.enqueue(input);
    } catch (error) {
      recordAdmissionRejection(
        toExecutionServiceError(error, 'EXECUTION_FAILED').code
      );
      throw error;
    }
  }
}
