export class ExecutionTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('Execution exceeded its wall-clock deadline.');
    this.name = 'ExecutionTimeoutError';
  }
}

export class ExecutionAbortedError extends Error {
  constructor() {
    super('Execution was aborted by the worker.');
    this.name = 'ExecutionAbortedError';
  }
}

export async function withWallClockTimeout<T>(
  startOperation: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  signal?: AbortSignal
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let operation: Promise<T> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        onTimeout();
      } finally {
        reject(new ExecutionTimeoutError(timeoutMs));
      }
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    const abortError = () =>
      signal?.reason instanceof Error &&
      signal.reason.name === 'RunCancellationError'
        ? signal.reason
        : new ExecutionAbortedError();
    if (signal?.aborted) {
      onTimeout();
      reject(abortError());
      return;
    }
    abortHandler = () => {
      onTimeout();
      reject(abortError());
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    operation = startOperation();
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    if (timedOut && operation) {
      void operation.catch(() => undefined);
    }
  }
}

export async function waitForCleanup(
  cleanup: Promise<void>,
  graceMs = 5_000
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
  });
  try {
    return await Promise.race([cleanup.then(() => true), grace]);
  } finally {
    if (timer) clearTimeout(timer);
    void cleanup.catch(() => undefined);
  }
}
