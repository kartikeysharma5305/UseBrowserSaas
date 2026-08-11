# Cost Controls and Resource Economics

## Boundaries

Phase 21 keeps three controls separate:

- Product quotas are the plan catalogue's monthly and per-Run allowances.
- Security rate limits bound request velocity and queue abuse.
- Cost guards reject work whose immutable execution envelope or remaining
  monthly resources would be unsafe.

All dashboard, public API, template test, run-now, and scheduled admissions use
`PrismaRunProducer`; no second charging or execution path exists.

## Cost model

| Dimension                                             | Measurement              | Meaning                                                                   |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Run admission, terminal status, attempt, browser step | Exact                    | Durable application/worker event                                          |
| Artifact bytes/count                                  | Exact                    | Retained artifact metadata after a successful object write                |
| Execution milliseconds                                | Derived                  | Wall-clock duration of every claimed worker attempt                       |
| LLM tokens                                            | Provider-reported        | Stored only when Groq history supplies valid prompt/completion totals     |
| Prospective Run resources                             | Maximum, not consumption | Configured timeout, steps, screenshot count and bytes reserved for safety |
| Monetary cost                                         | Unavailable              | No provider-pricing or dollar estimate is displayed or billed             |

`UsageRecord` remains the only ledger. Unique idempotency keys make terminal,
attempt-duration, step, token and artifact recording safe across duplicate
terminal calls, worker retry, and reconciliation.

## Central plan budgets

| Plan     | Runs/month | Execution/month | Per Run duration | Steps | Retained storage | Artifacts per Run | Artifact bytes per Run |
| -------- | ---------: | --------------: | ---------------: | ----: | ---------------: | ----------------: | ---------------------: |
| FREE     |         25 |      30 minutes |      120 seconds |    25 |          250 MiB |                10 |                 10 MiB |
| PRO      |        500 |        20 hours |      900 seconds |   100 |           10 GiB |                50 |                 25 MiB |
| INTERNAL |      5,000 |       250 hours |      900 seconds |   200 |           50 GiB |               100 |                 50 MiB |

The operator `ARTIFACT_MAX_BYTES_PER_RUN` ceiling may reduce, never increase,
the plan artifact-byte budget. A single artifact remains limited to 5 MiB.

## Admission and immutable runtime enforcement

Inside the existing per-user PostgreSQL advisory transaction, admission checks
the effective local plan, monthly Runs, consumed execution plus the requested
timeout, active Runs, retained storage, timeout and steps. Rejection creates no
Run, usage row, or BullMQ job. Stable cost codes include
`MONTHLY_EXECUTION_LIMIT_REACHED`, the existing Run/storage codes, and the
existing duration/step codes.

An admitted Run stores normalized `executionConfiguration` and a versioned
`costBudget`. The worker uses these snapshots for timeout, max steps, total
artifact bytes/count, and the admitted storage ceiling. Editing the Agent or
downgrading the account does not enlarge or shrink an in-flight Run. Future
admissions use the new Agent and plan state. Pre-Phase-21 queued Runs use a
documented compatibility fallback to their current Agent/plan because no
historical snapshot exists.

Screenshots are validated by signature, limited to 5 MiB each, deduplicated,
and stopped at the immutable count/byte budget. The worker also subtracts
currently retained user bytes before execution. Storage failure skips the
artifact and does not turn an otherwise successful browser result into a
failure. Retention and account-deletion cleanup continue through the storage
abstraction. Very close concurrent object writes use bounded worker snapshots,
not a billing-grade database byte reservation, and may temporarily overshoot a
retained-byte ceiling by at most the admitted active-Run envelopes.

## Retry and unattended execution economics

BullMQ remains bounded to three attempts with exponential backoff. A logical
Run consumes one admission; each claimed attempt and its wall-clock duration
are separately recorded. Released attempts record duration before retry, while
the terminal attempt records its duration once. Lease recovery cannot create a
second Run or duplicate usage keys.

Every scheduled occurrence enters normal admission. Cost exhaustion records a
durable `QUOTA_BLOCKED` occurrence, creates no Run/job, increments the existing
block counter, and uses the existing cooldown-aware schedule notification.
Later future occurrences may succeed after the UTC monthly period resets or
resources become available; the Schedule definition is retained. Public API
idempotency wraps the same admission service.

## User and operator surfaces

The Usage view separates monthly Runs, execution time, and retained storage
from per-Run duration, steps, artifact bytes, and screenshot count. It warns at
80% consumption and presents a maximum-resource preview without internal
prices. The existing ledger summary supplies admitted Runs, execution time,
terminal failures/timeouts, storage growth, attempts/retries, and token metrics
when available. Phase 20's `EXECUTION_ENABLED` remains the emergency stop.

Useful commands:

```text
pnpm test:cost-controls
pnpm --dir dashboard usage:reconcile
pnpm --dir dashboard usage:reconcile -- --apply
pnpm --dir dashboard prisma:status
```

## Runtime verification

The August 2026 local sandbox drill ran the complete `dev:all` stack against an
isolated Redis listener and the current 17-migration PostgreSQL schema:

- Disposable FREE over-duration and over-step admissions returned `422` and
  created no Runs. A bounded 10-second/two-step Run entered the normal queue,
  completed successfully, and recorded admission, attempt, terminal and
  execution-duration usage.
- A disposable PRO 300,000 ms configuration was admitted with immutable
  configuration/cost snapshots, then canceled without consuming the full
  allowance. INTERNAL retained its catalogue allowance.
- The public API returned the same `422` cost decision for the FREE Agent.
- A controlled PRO execution-ledger fixture made a scheduled occurrence
  durably `QUOTA_BLOCKED` with `MONTHLY_EXECUTION_LIMIT_REACHED`; no Run/job was
  created.
- Three harmless in-memory PNG candidates produced two writes under a
  two-screenshot test budget. The authenticated Usage API and page returned
  authoritative monthly execution limits/consumption.
- Usage reconciliation found no duplicate keys. Apply repaired derivable
  legacy facts; a repeated apply reported zero missing or repaired facts.

All disposable users/resources and the isolated runtime processes were removed.
No complete identifier, API key, provider secret, or monetary estimate was
logged by the verification script.

## Deferred work

Provider pricing, monetary estimates, Stripe metered billing, exact token data
when Groq omits usage, billing-grade concurrent byte reservations, full cost
analytics, automatic costly-failure restrictions, and operator dashboards are
outside Phase 21.
