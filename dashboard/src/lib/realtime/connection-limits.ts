interface Counts {
  users: Map<string, number>;
  runs: Map<string, number>;
}

const globalCounts = globalThis as typeof globalThis & {
  runStreamCounts?: Counts;
};

function counts(): Counts {
  return (globalCounts.runStreamCounts ??= {
    users: new Map(),
    runs: new Map(),
  });
}

export interface StreamLease {
  release(): void;
}

export function acquireStreamLease(
  userId: string,
  runId: string,
  maxPerUser: number,
  maxPerRun: number
): StreamLease | null {
  const state = counts();
  const userCount = state.users.get(userId) ?? 0;
  const runCount = state.runs.get(runId) ?? 0;
  if (userCount >= maxPerUser || runCount >= maxPerRun) return null;

  state.users.set(userId, userCount + 1);
  state.runs.set(runId, runCount + 1);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const nextUserCount = (state.users.get(userId) ?? 1) - 1;
      const nextRunCount = (state.runs.get(runId) ?? 1) - 1;
      if (nextUserCount <= 0) state.users.delete(userId);
      else state.users.set(userId, nextUserCount);
      if (nextRunCount <= 0) state.runs.delete(runId);
      else state.runs.set(runId, nextRunCount);
    },
  };
}

export function resetStreamConnectionCountsForTests(): void {
  globalCounts.runStreamCounts = {
    users: new Map(),
    runs: new Map(),
  };
}
