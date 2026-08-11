import { recoverStaleRuns } from '../src/lib/execution/stale-run-recovery';

const result = await recoverStaleRuns();
console.info(
  `Stale run recovery inspected ${result.inspected} and recovered ${result.recovered}.`
);
