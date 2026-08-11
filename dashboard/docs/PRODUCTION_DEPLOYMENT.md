# Production deployment

This runbook describes a provider-neutral, low-downtime deployment. It is not a
claim of zero downtime: an incompatible or irreversible migration requires a
maintenance window and a verified restore plan.

## Build and process model

Use a pinned Node 20/22 LTS runtime compatible with Prisma 6.19.3, install with
`pnpm install --frozen-lockfile`, install Playwright/Chromium system dependencies
for browser-worker hosts, then run `pnpm production:build`. The build generates
Prisma Client, builds the root browser engine, and builds Next.js; it does not
change a database. Keep the resulting code/build identity the same across web
and workers.

Run five independently restartable processes described in
`deploy/process-manifest.yaml`: web, browser worker, scheduler, notification
worker, and webhook worker. The systemd examples are optional templates, not a
requirement to use systemd. Do not use `dev:all` in production.

## Preflight and migration

With the target environment injected, run `pnpm production:preflight`. It checks
the environment contract, production CSP/Secure-cookie policy, bounded queue
configuration, PostgreSQL and Redis reachability, Redis 6.2+ and `noeviction`,
current Prisma migration status, and S3 bucket access when configured. It makes
no Groq or Stripe live API call and prints no secrets.

Before database changes:

1. Run and verify a current database backup and artifact backup.
2. Confirm the restore runbook and record the backup identifier outside logs.
3. Set `MIGRATION_BACKUP_VERIFIED=true` for the migration job only.
4. Run `pnpm production:migrate`, which uses only `prisma migrate deploy`.
5. Remove the one-shot confirmation variable after the job.

Never use `prisma db push`, `migrate dev`, or `migrate reset` on staging or
production. The runtime database role should have only application permissions;
use a separately controlled migration role for schema changes where the provider
supports it.

## Low-downtime rollout

1. Verify backups, configuration, security scan, and migration compatibility.
2. Apply additive/backward-compatible migrations.
3. Deploy the new web process and require authenticated readiness `200`.
4. Start new browser workers at conservative concurrency and verify heartbeats.
5. Signal old browser workers to drain; allow the configured drain timeout.
6. Replace scheduler, notification, and webhook workers one component at a time.
7. Verify queue depth, failed jobs, worker/component heartbeats, usage, and logs.
8. Run the read-only `pnpm production:smoke` from an authorized network.

`EXECUTION_ENABLED=false` is the emergency admission control. It does not delete
queued or active work. Billing/email remain controlled by their existing enable
flags. Avoid adding deployment-only flags without a concrete incident need.

## Data services

Prisma 6 supports PostgreSQL 9.6 through 18, but use a maintained managed major
version (16 or newer is the initial recommendation), TLS, automated backups and
PITR. Size aggregate Prisma pools across every web/worker replica below the
database limit; Prisma 6 accepts `connection_limit` and `pool_timeout` URL
parameters. Measure before changing defaults. Do not grant the runtime role
schema-owner permissions when separate roles are practical.

This repository pins BullMQ 5.81.1 and ioredis 5.11.1. Production requires Redis
6.2 or newer, persistence appropriate to the provider (BullMQ recommends AOF),
`maxmemory-policy=noeviction`, authentication/network isolation, and TLS where
available. Redis accelerates queues and heartbeats but PostgreSQL remains the
business authority; restore/reconciliation rebuilds jobs. Staging and production
must use separate Redis instances, not merely different queue names.

Version and operating guidance is based on the official
[BullMQ Redis compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility),
[BullMQ production](https://docs.bullmq.io/guide/going-to-production),
[Prisma supported databases](https://docs.prisma.io/docs/orm/v6/reference/supported-databases),
and [Prisma connection pool](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)
documentation. Recheck those sources when upgrading pinned dependencies.

Use private S3-compatible object storage in production. Objects do not need
public ACLs or public URLs; downloads remain owner-scoped through the app. Use
separate staging/production buckets, least-privilege credentials, encryption,
lifecycle rules aligned with product retention, and independently verified
artifact backups. Local disk is host-bound and only a documented exception.

## Worker sizing and logging

Start browser workers at concurrency 1. Keep heartbeat below lease duration,
allow a 30-second drain and a 5-second browser cleanup window, then measure RAM,
CPU, queue wait, and Chromium stability before increasing concurrency (hard cap
10). Web processes need materially less memory than Chromium workers. Scheduler
is lightweight; notification/webhook defaults are 3/4 with hard caps 20. These
are conservative starting points, not capacity guarantees.

All processes log structured operational records to stdout/stderr with recursive
secret redaction. Send those streams to the platform log collector without
adding ANSI transformations or request-body/provider-payload capture.

## Smoke, rollback, and recovery

`pnpm staging:test:runtime` creates an isolated temporary PostgreSQL database,
Redis, and artifact root; applies migrations; starts the production build and
all workers; verifies auth, Agent/Run, schedule, API-key lifecycle, webhook and
safe email fixtures, usage, protected metrics, backup, export/deletion, and
browser-worker drain; then removes its resources. Never point it at production.

`pnpm production:smoke` is read-only: it checks public/login/legal pages and
protected health/readiness/metrics. A synthetic Run is permitted only through a
dedicated INTERNAL account and an explicit operator decision.

- Code failure: stop rollout and restore the prior build if DB/API compatibility
  remains intact.
- Migration failure: stop; do not invent a reverse migration. Restore the
  verified backup into a clean database when required and follow the DR runbook.
- Worker failure: drain/stop the faulty version and resume a queue-compatible
  prior worker.
- Configuration failure: restore the prior secret/config version, restart the
  affected process, and require readiness before traffic.

Never promise a simple rollback across destructive schema or data changes.

## Phase 26 staging evidence

On 2026-08-10, the staging drill created a separately named temporary
PostgreSQL database, Redis 7.4 instance, and artifact root. All 19 migrations
applied and live preflight verified PostgreSQL, Redis `noeviction`, migration
status, CSP, Secure-cookie policy, and storage configuration. The optimized
build started with web, browser, scheduler, notification, and webhook workers.

A disposable INTERNAL user signed up and logged in, created an Agent, admitted
a bounded example.com Run, and the browser worker attempted and terminally
resolved it through the normal queue path. The drill also verified schedule
creation and scheduler heartbeat, usage accounting, API-key create/use/revoke,
an outbound webhook attempt, development-provider notification delivery,
public legal pages, protected metrics, database backup verification, data
export, account deletion/session invalidation, and browser-worker drain. It
then dropped the temporary database and removed Redis/artifact/backup resources.

This local drill intentionally used host-bound temporary artifacts, HTTP
localhost under the staging-only drill exception, disabled Stripe billing, and
the development email provider. Real staging DNS/TLS, private S3, Stripe test
resources, provider email sandbox/domain setup, and managed-network controls
remain deployment-owner verification gates.
