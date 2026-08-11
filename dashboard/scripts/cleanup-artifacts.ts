import { cleanupExpiredArtifacts } from '../src/lib/browser/artifact-retention';

const dryRun = !process.argv.includes('--apply');
const result = await cleanupExpiredArtifacts({ dryRun });
console.info(
  `Artifact cleanup ${dryRun ? 'dry-run' : 'apply'}: ${result.eligible} eligible, ${result.deleted} deleted, ${result.failed} failed.`
);
