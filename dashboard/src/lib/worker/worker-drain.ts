export interface DrainableWorker {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
}

async function waitForIdle(
  activeCount: () => number,
  timeoutMs: number,
  pollMs = 25
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (activeCount() > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, remaining))
    );
  }
  return true;
}

export async function drainBrowserWorker(input: {
  worker: DrainableWorker;
  activeCount: () => number;
  abortActive: () => void;
  drainTimeoutMs: number;
  cleanupTimeoutMs: number;
}): Promise<{ forced: boolean; cleanupCompleted: boolean }> {
  await input.worker.pause(true);
  const drained = await waitForIdle(input.activeCount, input.drainTimeoutMs);
  if (drained) {
    await input.worker.close(false);
    return { forced: false, cleanupCompleted: true };
  }

  input.abortActive();
  const cleanupCompleted = await waitForIdle(
    input.activeCount,
    input.cleanupTimeoutMs
  );
  await input.worker.close(!cleanupCompleted);
  return { forced: true, cleanupCompleted };
}
