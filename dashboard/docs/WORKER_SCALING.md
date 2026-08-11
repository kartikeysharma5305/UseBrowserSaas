# Production Browser Worker Scaling

Phase 23 operational metrics and protected health/readiness behavior are
documented in `OBSERVABILITY.md`. WorkerInstance remains the durable browser
fleet source; scheduler and delivery-worker timestamps are ephemeral Redis
health signals.

## Runtime model

PostgreSQL is authoritative for a Run and its execution lease. BullMQ/Redis is
durable delivery and coordination infrastructure; neither a BullMQ lock nor a
worker-health row grants permission to execute. Each browser worker is a
separate process and every Run creates and closes its own browser session.
Persistent or cross-user browser contexts are not supported.

The queue payload remains the versioned minimum `{ version: 1, runId }`. A
worker rejects unknown payload versions before attempting a database claim and
loads the immutable execution configuration and Phase 21 cost budget from
PostgreSQL.

## Identity and health

Every process creates a restart-unique worker ID from a sanitized hostname,
PID, and UUID. The ID is used in structured operational logs and Run lease
ownership, but is never returned by customer-facing Run resources.

`WorkerInstance` is durable operational state, not an execution lock. It stores
`STARTING`, `ACTIVE`, `DRAINING`, `STOPPED`, or `LOST`, timestamps, configured
concurrency, active count, and an optional bounded build version. The default
15-second heartbeat is deliberately much less frequent than Run heartbeats.
On startup, records whose health heartbeat is older than the greater of four
health intervals or two Run leases are marked `LOST`. A stale health row does
not by itself release a Run; lease expiry remains the safety boundary.

No public health endpoint exposes worker topology. Readiness is represented by
the sanitized `Browser worker ready` log and the corresponding ACTIVE database
record. External process supervision should also check database, Redis, and
migration readiness before starting workers.

## Claim and lease safety

Claiming takes a PostgreSQL transaction-scoped advisory lock derived from the
Run ID, then atomically changes only a `QUEUED` Run or a `RUNNING` Run with an
expired lease. A valid lease cannot be stolen. The owning worker ID is required
for heartbeats and terminal/retry writes. Therefore duplicate queue deliveries,
multiple workers, or a restarted worker can produce only one effective owner at
a time. Retries increment the attempt on the same logical Run; Phase 21 usage
keys remain deterministic per Run/attempt and terminal accounting remains
idempotent.

Defaults are a 20-second lease and a 5-second Run heartbeat. A crashed process
becomes recoverable after lease expiry. BullMQ may redeliver a stalled job, and
`pnpm --dir dashboard queue:recover -- --apply` repairs missing jobs and expired
leases. Reconciliation takes the same per-Run advisory lock for state changes,
never requeues a valid leased Run, uses the Run ID as the deterministic job ID,
and safely tolerates another reconciler doing the same work.

## Capacity and operational bounds

`BROWSER_WORKER_CONCURRENCY` controls local process capacity and is validated
from 1 through 10 (default 1). The legacy
`EXECUTION_QUEUE_CONCURRENCY` remains a compatibility fallback. Machine
capacity is intentionally independent of plan concurrency: INTERNAL or paid
admission cannot make one worker launch more browsers than its configured
limit. Existing Phase 20 queue/backpressure admission and per-user/Agent
limits, plus Phase 21 immutable timeout, step, artifact, and cost budgets,
remain authoritative.

`BROWSER_SHUTDOWN_TIMEOUT_MS` bounds browser cleanup from 1 to 30 seconds
(default 5 seconds). Execution timeouts and browser startup behavior remain
bounded by the existing immutable Run configuration. A cross-platform
memory-pressure admission check is deferred because portable RSS attribution
for Chromium process trees is unreliable; deployers must set concurrency from
measured machine capacity and use process/cgroup limits.

## Graceful drain and crash recovery

On SIGTERM or SIGINT the worker:

1. pauses local BullMQ intake immediately and records `DRAINING`;
2. continues Run lease and worker-health heartbeats while active work drains;
3. waits up to `WORKER_DRAIN_TIMEOUT_MS` (1 second to 5 minutes, default 30
   seconds);
4. if still active, cooperatively aborts each local execution;
5. allows one bounded browser-cleanup interval;
6. closes BullMQ, cancellation Redis, and database connections and records
   `STOPPED`.

The same drain path accepts the private Node process message
`browser-worker:shutdown`; this supports PM2/Node supervisors and deterministic
Windows verification where POSIX SIGTERM delivery is not available. It is
process-local IPC, not a network or customer API.

An ordinary deployment therefore does not abort active work immediately. If
the grace expires, the existing processor releases retryable attempts to the
same logical Run. A hard process or machine loss cannot perform cleanup, so the
lease expires after at most the configured lease interval and reconciliation or
BullMQ stalled-job recovery permits another worker to claim it. No replacement
may claim while the old lease is valid.

The browser engine closes its browser exactly once from a `finally` path on
success, failure, timeout, or cancellation. Temporary browser state is scoped
to that session. A host-level hard kill should be contained by the service
cgroup/job object so Chromium descendants cannot outlive the service.

## Deployment and commands

Local development remains:

```text
pnpm dev:all
```

Production processes are independently runnable:

```text
pnpm dashboard:start
pnpm dashboard:worker
pnpm scheduler:start
pnpm --dir dashboard worker:notifications
pnpm --dir dashboard worker:webhooks
```

Run more than one `dashboard:worker` process against the same PostgreSQL and
Redis instances to scale horizontally. Keep the dashboard, workers, migration,
and queue protocol on a compatible release during rolling restarts. Set
`WORKER_BUILD_VERSION` to a non-secret deployment identifier. The repository
does not require a process manager: systemd may use the existing units, PM2 may
declare the commands as separate applications, and Docker deployments should
use one process type per container with SIGTERM forwarded to Node.

Before rollout, deploy migrations, build the root engine and dashboard, and
generate Prisma Client. After an abnormal outage run queue recovery in dry-run
mode before applying it. Artifact storage must be shared S3-compatible storage
for workers on different machines; local artifact storage is suitable only for
a single shared filesystem.

## Verification and residual risk

Phase 22 focused tests cover identity, health transitions, bounded config,
graceful and forced drain branches, unsupported queue protocol rejection,
database claim/lease contracts, reconciliation locking, and public DTO
redaction. Existing queue, lease, cancellation, browser lifecycle, recovery,
and cost-control suites provide the affected regression coverage. Runtime drill
evidence is recorded in the Phase 22 completion report rather than embedding
environment-specific identifiers here.

### Phase 22 local runtime evidence (2026-08-09)

- The production dashboard returned HTTP 200 while two production browser
  worker processes shared one isolated Redis queue and PostgreSQL database.
- Both workers registered ACTIVE with concurrency 1. Duplicate delivery was
  deliberately requested for one disposable Run; PostgreSQL recorded one
  attempt, one RUN_STARTED event, one terminal event, and five distinct usage
  idempotency keys. A real production-path browser execution completed
  successfully in the first drill; a later repetition also retained the same
  uniqueness invariants when the external execution ended FAILED.
- The real scheduling processor admitted a disposable one-time occurrence into
  the same queue. Cancellation reached its owning worker and persisted one
  CANCELED Run and one RUN_CANCELED event while the other worker remained safe.
- Both production workers accepted the bounded IPC drain command, exited 0, and
  persisted STOPPED. A controlled active-Run drill exhausted its one-second
  grace, released the lease, and the replacement completed the same Run at
  attempt 2 without duplicate execution.
- A forced process-tree termination stopped heartbeats; another worker did not
  claim before the five-second lease expired, then recovered the same logical
  Run at attempt 2 with one terminal event and unique event sequences.
- No Playwright/browser-use-attributable Chromium process remained afterward.
  Queue reconciliation against an isolated Redis instance repaired six
  pre-existing missing jobs on first apply and reported zero missing jobs on
  the repeated apply.

Deferred work includes autoscaling, memory-aware admission, multi-region
coordination, persistent browser sessions, richer internal fleet telemetry, and
full observability. These belong to later infrastructure/observability phases.
