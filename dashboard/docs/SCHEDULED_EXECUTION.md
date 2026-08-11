# Scheduled execution

## Architecture

Phase 6C adds a PostgreSQL-authoritative `Schedule` and
`ScheduledOccurrence` subsystem. The standalone schedule worker scans due rows
in bounded batches and submits eligible occurrences through the existing
`PrismaRunProducer`; it does not execute browser work or create a second queue.
BullMQ continues to receive only `{ version, runId }`, and the browser worker
loads all trusted state from PostgreSQL.

The legacy `Agent.scheduleType` and `Agent.scheduleConfig` columns remain for
compatibility but are deprecated. They are not scheduler truth.

`Schedule` stores its owner, Agent, kind, IANA timezone, local time, selected
ISO weekdays, optional one-time instant, state, next UTC occurrence, last
triggered instant, failure/block counters, and version. `ScheduledOccurrence`
stores the durable identity and outcome. Its unique `(scheduleId,
scheduledFor)` constraint prevents duplicate discovery, while a deterministic
scheduled Run ID and transactional occurrence-to-Run link prevent duplicate
admission. PostgreSQL advisory locks coordinate schedule edits, scans, Agent
deletion, and concurrent scheduler instances; correctness does not depend on a
Redis lock.

Deleting a Schedule or Agent cascades its occurrence history but never deletes
an already-created Run. Account deletion removes schedules with the owning
Agent under the existing recoverable workflow.

## Recurrence and timezones

API definitions are intentionally structured rather than cron expressions:

- `ONCE`: `timezone` plus a future `oneTimeAt` instant.
- `DAILY`: `timezone` plus `localTime` in `HH:mm`.
- `WEEKLY`: the daily fields plus one or more ISO weekdays (`1` Monday through
  `7` Sunday).

Luxon performs all IANA timezone calculations independent of the host timezone.
Recurring schedules preserve local wall-clock time. A nonexistent
spring-forward time shifts forward by the DST gap. A repeated fall-back time
uses the earliest possible instant and is emitted exactly once. Both rules have
deterministic tests.

One-time schedules are disabled as soon as their occurrence is discovered,
including when admission is blocked. They remain eligible for 24 hours and are
then recorded `MISSED`. Recurring scans use a 24-hour lookback: only the latest
eligible occurrence may be admitted, while an older persisted due instant is
recorded `MISSED`. No unbounded catch-up backlog is created. Policy constants,
the 50-row batch, 15-second poll, one-minute processing lease, and bounded five
admission attempts live in `src/lib/scheduling/policy.ts`.

## Admission, plans, and failures

Scheduled admission reuses the same Agent configuration normalization, monthly
usage ledger, per-Agent active constraint, per-user active limit, storage
quota, Run transaction, BullMQ enqueue, and worker processor as Run-now/manual
admission. Queue payloads contain no schedule, user, task, or configuration
data.

Scheduling availability is part of the central plan catalogue:

- FREE: disabled, zero active schedules.
- PRO: enabled, at most 10 active schedules.
- INTERNAL: enabled, at most 100 active schedules.

Downgrades retain definitions and history. Each due occurrence becomes
`PLAN_BLOCKED`; existing Runs continue. Upgrading and explicitly resuming
recomputes future execution without backlog. Normal browser Run failure does
not pause a Schedule. Automatic pause after repeated browser failures is
deferred to Phase 6D.

Occurrence outcomes distinguish discovered, admitted, skipped, quota blocked,
active-limit blocked, plan blocked, account blocked, Agent blocked, missed,
canceled, and failed admission. Transient infrastructure failures clear their
lease and retry after a bounded delay; terminal errors retain sanitized codes.
One broken schedule is isolated from the rest of a worker tick.

## API and lifecycle semantics

All routes require an authenticated session, derive the owner server-side,
verify Agent/Schedule ownership in the service, validate with Zod, and return
sanitized errors:

```text
GET    /api/schedules
POST   /api/schedules
GET    /api/schedules/:id
PATCH  /api/schedules/:id
DELETE /api/schedules/:id
POST   /api/schedules/:id/pause
POST   /api/schedules/:id/resume
POST   /api/schedules/:id/skip-next
POST   /api/schedules/:id/run-now
GET    /api/schedules/:id/occurrences?limit=25&cursor=...
```

Pause retains history and does not cancel Runs. Resume recomputes the next
eligible occurrence. Edit increments the optimistic version, changes only
future occurrences, and leaves existing occurrences/Runs immutable. Skip-next
durably records `SKIPPED` before advancing. Delete prevents future triggers and
removes occurrence history without canceling admitted Runs. Run-now calls the
ordinary manual admission path and does not read or advance `nextRunAt`.

Agent deletion takes the same advisory locks as discovery before its cascading
delete. Account deletion cancels unadmitted occurrences and pauses all owned
schedules before normal Run/artifact/billing cleanup. Both pending and failed
deletion states block scheduled admission.

## Dashboard UI

`/dashboard/schedules` is the owner-scoped scheduling workspace. Scheduling is
also present in desktop and mobile navigation, and each Agent detail page shows
only that Agent's schedules. The responsive schedule cards show the Agent,
human-readable recurrence, timezone, authoritative next occurrence, last
trigger, lifecycle state, and latest occurrence outcome. Expanding history
loads ten sanitized occurrences at a time and links admitted entries to the
existing Run detail page.

The create/edit form supports one-time, daily, and selected-weekday weekly
definitions. It defaults to a valid browser IANA timezone, exposes only IANA
timezone options, validates weekday and future-date input locally, and sends
the same structured contract enforced by the API. Its recurrence preview is a
human-readable aid; `nextRunAt` returned by the backend remains authoritative.
For one-time input, the selected local wall-clock value is converted to a UTC
instant before submission. Help text explains that local wall-clock time is
preserved, nonexistent DST times move forward by the gap, and repeated times
use the earliest instant once.

Edit submits the current optimistic version and translates a conflict into a
refresh-and-retry instruction. Pause confirms that existing Runs continue.
Skip-next names the occurrence being skipped and records it durably. Delete
confirms that existing Runs are not canceled. Run now uses the manual admission
route and explicitly reports that the next scheduled occurrence was unchanged.
All actions suppress duplicate clicks and refresh authoritative state after
success or failure. Loads and history requests use abort signals and sequence
guards so an unmounted or stale request cannot overwrite newer state.

Occurrence explanations are fixed public messages rather than stored provider
errors. They distinguish admitted, skipped, quota blocked, active-limit
blocked, plan blocked, account/Agent blocked, missed, canceled, and failed
admission states. FREE users see retained schedules plus an upgrade link, but
cannot create or resume them. PRO and INTERNAL users see active schedule usage
against the server-provided plan limit. No Stripe-specific decision exists in
the scheduling UI.

## Operation and recovery

```bash
pnpm scheduler:start
pnpm dev:scheduler
pnpm test:scheduling
pnpm dev:all
```

`pnpm dev:all` starts the scheduler beside the dashboard, engine watcher, and
browser worker. Production supervisors may run multiple scheduler instances.
An expired occurrence lease makes pre-admission work restart-recoverable;
existing queue recovery remains responsible for a committed QUEUED Run whose
process dies before BullMQ enqueue. SIGINT/SIGTERM stop polling and disconnect
Prisma. Logs contain bounded counters and sanitized errors, never task content
or credentials.

## Runtime verification

On 2026-08-06, disposable users registered through the application verified
FREE rejection and trusted INTERNAL assignment. Two simultaneous scheduler
processes discovered one near-future one-time occurrence, created exactly one
Run in the existing queue, and the existing worker claimed it. With all
schedulers stopped, a second occurrence passed due without discovery; a newly
started scheduler recovered and admitted it.

A real next-minute daily schedule remained untriggered while paused. Resume
recomputed the following local-day occurrence without backlog, skip-next
recorded one immutable skipped occurrence and advanced again, and Run-now left
the scheduled occurrence unchanged. A real-database edit incremented the
version and recomputed the future while preserving history. Disposable Agent
and account deletion prevented their near-future schedules from producing a
Run, and another user's Agent and Schedule were unchanged.

On 2026-08-06, the Phase 6D Playwright drill used disposable users registered
through the application. It verified FREE restriction and upgrade guidance,
trusted INTERNAL limits, UI creation of one-time/daily/weekly schedules, edit,
pause/resume, durable skip-next, and Run now without changing `nextRunAt`. The
one-time definition was edited to a near-future occurrence; the live scheduler
admitted it through the existing queue, the browser worker processed its Run,
and occurrence history linked to the existing Run detail page. Deleting the
Schedule preserved that Run.

The same drill verified Agent-detail integration, a 390-pixel-wide layout and
mobile Scheduling navigation, sanitized schedule responses, and safe 404
responses for another user's read and mutation attempts. The reproducible
command is:

```bash
pnpm --dir dashboard phase6d:test:runtime
```

Notifications, email, automatic failure messages, calendar/month views, and
automatic pause after repeated browser failures remain deferred. Phase 6D does
not change the Phase 6C scheduler or execution architecture.
