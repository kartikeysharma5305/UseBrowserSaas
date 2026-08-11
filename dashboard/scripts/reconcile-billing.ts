import { reconcileBilling } from '../src/lib/billing/reconciliation';

const apply = process.argv.includes('--apply');
const result = await reconcileBilling({ apply });
console.log(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      inspected: result.inspected,
      repaired: result.repaired,
      failed: result.failed,
      issues: result.issues,
    },
    null,
    2
  )
);
