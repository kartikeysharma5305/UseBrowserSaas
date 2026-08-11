# Usage, Plans, and Quotas

## Plans

The server-side catalogue in `src/lib/plans/catalogue.ts` is authoritative.
Clients receive displayable limits but cannot supply a plan or user ID.

| Plan     | Runs/month | Execution/month | Active Runs | Max duration | Max steps | Retained storage | Retention |
| -------- | ---------: | --------------: | ----------: | -----------: | --------: | ---------------: | --------: |
| FREE     |         25 |          30 min |           1 |        120 s |        25 |          250 MiB |    7 days |
| PRO      |        500 |            20 h |           2 |        900 s |       100 |           10 GiB |   30 days |
| INTERNAL |      5,000 |           250 h |           5 |        900 s |       200 |           50 GiB |   90 days |

`pnpm plans:assign -- --email=user@example.com --plan=PRO` is dry-run.
Add `--apply` after verifying the exact email and proposed transition.

## Ledger Semantics

`UsageRecord` is an append-only, user-attributed ledger with UTC calendar-month
periods and unique idempotency keys. Quantities use database `BIGINT` and API
strings to avoid JavaScript precision loss.

- Run admission, terminal outcomes, attempts, execution milliseconds, browser
  steps, artifact bytes, and provider-reported LLM tokens are separate facts.
- One logical Run consumes one monthly admission even when BullMQ retries it.
- Every claimed attempt is metered separately.
- Token rows are created only from Groq's reported prompt/completion values;
  unavailable metrics remain unavailable rather than estimated.
- Retained storage is the current sum of artifact metadata. Historical artifact
  bytes remain in the ledger after retention deletes an object.

## Enforcement

Admission runs inside the existing per-user PostgreSQL advisory lock. The
transaction reads the trusted session user, plan, current monthly admissions,
consumed execution, active Runs, retained storage, and requested execution bounds before creating
the `QUEUED` Run and its admission record. Concurrent requests cannot both
consume the last monthly or active slot.

The admitted Run stores immutable normalized configuration and a versioned cost
budget. The worker enforces that snapshot rather than mutable Agent or plan
values; future admissions use any edited Agent or downgraded entitlement.
Stable failures are `MONTHLY_RUN_LIMIT_REACHED`, `USER_RUN_LIMIT_REACHED`,
`MONTHLY_EXECUTION_LIMIT_REACHED`,
`MAX_RUN_DURATION_EXCEEDED`, `MAX_STEPS_EXCEEDED`,
`STORAGE_LIMIT_REACHED`, and `PLAN_CONFIGURATION_INVALID`.

Artifact growth by multiple active workers uses a pre-execution budget
snapshot. It is bounded and rechecked, but not a database reservation; very
close concurrent uploads can temporarily exceed retained-storage quota.

## Reporting and Reconciliation

Authenticated users can read only their own data:

- `GET /api/usage/current`
- `GET /api/usage/history`
- `/dashboard/usage`

The current endpoint returns plan limits, monthly counts, attempt and duration
usage, retained bytes, and LLM tokens only when exact provider metrics exist.

Reconciliation is dry-run by default:

```bash
pnpm usage:reconcile
pnpm usage:reconcile -- --apply
```

It reports missing admissions, terminal facts, attempt durations, artifact-byte
facts, UTC period drift, attempt mismatches, negative quantities, detached
historical records, and unmetered retained bytes. The database unique
idempotency constraint prevents duplicate keys. Apply repairs only facts
derivable from durable Run and artifact data and is idempotent. It never
invents historical token usage.

Stripe billing updates only `User.planCode` and `planSource` through the central
entitlement synchronizer. Admissions and reporting continue to read this same
catalogue; billing modules contain no duplicate quota values. Upgrade and
downgrade do not reset the append-only monthly ledger. Downgrades affect future
admission, do not kill active Runs, and artifact cleanup applies the existing
retention grace rather than deleting objects immediately.

See `docs/COST_CONTROLS.md` for cost dimensions, immutable runtime budgets,
artifact limits, retry economics, and scheduled/public admission behavior.
