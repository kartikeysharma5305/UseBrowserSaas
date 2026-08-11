export interface RunDurationSource {
  attempt?: number | null;
  createdAt: Date;
  startedAt: Date;
  completedAt: Date | null;
  duration: number | null;
}

export function presentRunDuration(run: RunDurationSource) {
  const retried = (run.attempt ?? 1) > 1;
  const totalDuration =
    retried && run.completedAt
      ? Math.max(0, run.completedAt.getTime() - run.createdAt.getTime())
      : run.duration;

  return {
    startedAt: retried ? run.createdAt : run.startedAt,
    duration: totalDuration,
    attemptDuration: retried ? run.duration : null,
  };
}
