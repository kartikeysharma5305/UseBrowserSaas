import { RunCancellationError } from '@/lib/runs/cancellation-types';

export class ActiveRunRegistry {
  private readonly executions = new Map<string, AbortController>();

  register(runId: string, controller: AbortController): () => void {
    if (this.executions.has(runId)) {
      throw new Error('Run is already registered in this worker.');
    }
    this.executions.set(runId, controller);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.executions.get(runId) === controller) {
        this.executions.delete(runId);
      }
    };
  }

  requestCancellation(runId: string): boolean {
    const controller = this.executions.get(runId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new RunCancellationError(runId));
    return true;
  }

  abortAll(): void {
    for (const controller of this.executions.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
  }

  has(runId: string): boolean {
    return this.executions.has(runId);
  }

  get size(): number {
    return this.executions.size;
  }
}
