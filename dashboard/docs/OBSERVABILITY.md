# Observability and Operational Monitoring

Production probes and process health signals are mapped in
`deploy/process-manifest.yaml` and `PRODUCTION_DEPLOYMENT.md`. Internal endpoints
remain token/INTERNAL-session protected; load balancers must supply the bearer
token through a private probe configuration rather than making them public.

## Architecture

Phase 23 adds a provider-neutral observability layer without introducing a
telemetry database or an external monitoring vendor. PostgreSQL remains the
business source of truth, BullMQ supplies cached queue snapshots, and a small
in-process registry records transient security, public API, admission, and
billing request signals. Monitoring failures never mutate or block Run state.

The internal snapshot is cached for five seconds and bounds recent scans to
5,000 Runs, 2,000 notification deliveries, 2,000 webhook deliveries, and 20
sanitized incidents. Durable counters use existing Run, event, usage,
schedule, notification, webhook, billing, and WorkerInstance records. No
duplicate telemetry table or migration is required.

## Access and endpoints

The following endpoints return 404 unless the request has either an active
INTERNAL session or `Authorization: Bearer <OBSERVABILITY_TOKEN>` with a
configured token of at least 32 characters:

```text
GET /api/internal/health
GET /api/internal/readiness
GET /api/internal/metrics
GET /api/internal/operations
```

`health` proves the dashboard process can answer. `readiness` independently
checks PostgreSQL and Redis and returns 503 when either is unavailable. Groq,
Stripe, email, and outbound customer endpoints are deliberately not core
readiness dependencies. Responses are no-store, nosniff, and noindex.

`metrics` uses Prometheus 0.0.4 text format but does not require a Prometheus
server. `operations` returns the same sanitized model as bounded JSON. An
INTERNAL-only page is available at `/dashboard/internal/operations`. INTERNAL
is the current safe operator boundary, not a replacement for future admin RBAC.

## Logging and redaction

The existing logger remains the only logging framework. `logger.operation`
adds JSON records with timestamp, level, component, event, and bounded safe
fields. Components include dashboard, browser-worker, scheduler,
notification-worker, webhook-worker, billing, public-api, security, and
reconciliation. Existing Phase 20 recursive key and token redaction is applied
before serialization.

Never log passwords, cookies, authorization headers, sessions, API keys,
webhook or encryption secrets, Stripe secrets/payloads, Agent SECRET values,
recipient addresses, request bodies, or provider payloads. Run and worker IDs
may appear only in operator logs and the bounded incident view; neither is a
metric label.

## Metric definitions

The Prometheus response is capped at 500 samples. Labels are fixed enums; it
never uses email, URL, Run ID, Agent ID, API-key prefix, arbitrary message, or
provider error text.

- `runs_admitted_total`: current authoritative count of Run records.
- `runs_started_total`: Runs whose attempt count is greater than zero.
- `runs_completed_total{status}`: current all-time terminal Run counts.
- `run_retries_total`: all-time attempts beyond each Run's first attempt.
- `run_recoveries_total`: durable expired-lease recovery events.
- `run_admission_rejections_total{reason}`: process-lifetime bounded rejection
  counter.
- `current_active_runs`, `current_queued_runs`: current database gauges.
- `run_execution_duration_ms`, `queue_wait_duration_ms`: averages over at most
  the newest 5,000 Runs created during the trailing 24 hours. Queue wait is
  `startedAt - queuedAt`.
- `queue_{waiting,active,delayed,failed,paused}{queue}`: browser,
  notifications, and webhooks BullMQ snapshots.
- `browser_worker_instances{status}`, `browser_worker_capacity`, and
  `browser_worker_active_executions`: WorkerInstance-derived fleet state.
- `schedule_occurrences_total{status}`: authoritative occurrence outcomes.
- `notification_deliveries_total{status}` and
  `webhook_deliveries_total{status}`: authoritative delivery outcomes.
- `billing_webhook_events_total{status}`: persisted Stripe processing states.
- `reconciliation_repairs_total{subsystem}`: durable Run queue recovery events
  and subscriptions whose latest authoritative Stripe sync was a reconciliation
  repair during the trailing 24 hours.
- `usage_quantity_24h{type}`: execution milliseconds, browser steps, retained
  artifact bytes, and exact/provider-reported token quantities. These are raw
  operational quantities, never monetary estimates.
- `security_rejections_total{control}` and
  `public_api_requests_total{outcome,operation}`: process-lifetime signals with
  bounded labels. Idempotent public API replays have a separate counter.

Notification latency is `sentAt - createdAt`; webhook latency uses the stored
bounded request duration. Retry counts use `attemptCount > 0` while pending.
Webhook HTTP 429s and disabled endpoints are summarized without target labels.

## Scheduler and worker heartbeats

Browser workers use durable Phase 22 WorkerInstance heartbeats. Scheduler,
notification, and webhook workers publish a sanitized timestamp-only Redis key
with a 120-second TTL. Heartbeat write failure is swallowed and never fails the
worker's business loop. The operations view exposes only component timestamps,
not hostnames or process IDs.

## Incidents and severity

Recent incidents are derived from failed/timed-out Runs and failed
notification, webhook, and billing records. Fields are limited to timestamp,
subsystem, status, safe code, attempt, and—only for INTERNAL operators—Run ID.
Task text, variables, delivery destinations, recipient addresses, raw errors,
and payloads are excluded.

Severity is alert-ready, not an alert delivery system:

- CRITICAL: a critical queue is unavailable, or browser work is waiting with
  no ACTIVE worker.
- DEGRADED: oldest queued Run exceeds 60 seconds, the trailing Run
  failure/timeout rate exceeds 25%, or a present scheduler heartbeat is older
  than 60 seconds.
- OK: none of those conditions is present.

Recommended external alerts additionally include PostgreSQL/Redis readiness,
no active workers, repeated recoveries, timeout growth, notification/webhook
failure spikes, billing processing failures, storage usage near plan/system
capacity, and unusual execution-duration growth. Scrapers should evaluate
these exported values; Phase 23 does not send PagerDuty, Slack, or email alerts.

## Commands and integration

```text
pnpm test:observability
curl -H "Authorization: Bearer $OBSERVABILITY_TOKEN" \
  http://localhost:3001/api/internal/health
curl -H "Authorization: Bearer $OBSERVABILITY_TOKEN" \
  http://localhost:3001/api/internal/readiness
curl -H "Authorization: Bearer $OBSERVABILITY_TOKEN" \
  http://localhost:3001/api/internal/metrics
```

Configure an external Prometheus-compatible scraper to use the protected
metrics endpoint. Grafana, OpenTelemetry collectors, log warehouses, tracing,
long-term metric retention, and alert delivery remain optional future
integrations rather than runtime dependencies.

Backup verification, restore, and empty-Redis recovery procedures are defined
in [BACKUP_AND_DISASTER_RECOVERY.md](./BACKUP_AND_DISASTER_RECOVERY.md).

## Runtime evidence and limitations

The isolated Phase 23 runtime drill started the complete `pnpm dev:all` stack
against disposable Redis data and verified HTTP 200 health/readiness, hidden
unauthenticated metrics (HTTP 404), INTERNAL access, and denial for disposable
FREE and PRO sessions. Controlled successful and failed Runs moved their
respective series. Two ACTIVE browser workers were observed and a graceful
drain reduced the fleet count. A controlled login rate limit, FREE-plan
schedule block, notification failure, outbound-webhook failure, and billing
webhook failure were all visible through bounded signals. The disposable
secret marker was absent. After stopping development processes, a fresh
production build and `next start` returned the same protected health and
metrics behavior. Fixtures were deleted and no external provider credits were
used.

Process-lifetime counters reset on dashboard restart and are not fleet-wide;
durable business metrics remain database-derived. Redis queue and component
heartbeat data is intentionally ephemeral. The Run-duration scan is a bounded
recent sample, not a customer analytics dataset. A runtime notification publish
attempt encountered the established Redis-to-database fallback while the
deterministic fixture was driven from the verification process; Run state and
the drill remained durable, but this is not proof of notification fan-out from
that external fixture process. Multi-region aggregation, distributed tracing,
dedicated administrator RBAC, and durable security-event aggregation are
deferred.
