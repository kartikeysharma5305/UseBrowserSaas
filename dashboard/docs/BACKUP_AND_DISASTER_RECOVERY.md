# Backup, Restore, and Disaster Recovery

Production deployment order and guarded migration usage are defined in
`PRODUCTION_DEPLOYMENT.md`; a verified backup is required before the one-shot
`production:migrate` command is authorized.

## Scope and data classification

PostgreSQL is authoritative. A database backup includes authentication state,
users, Agents and variables, Runs/events/results/artifact metadata, schedules
and occurrences, the usage ledger, subscriptions and billing webhook state,
notifications/deliveries, API-key hashes and audit metadata, encrypted outbound
webhook secrets, account-deletion state, and worker records. The complete set is
captured by PostgreSQL rather than by a hand-maintained table list.

Artifact objects are a separate required backup set: screenshots and retained
Run files in local or S3-compatible storage. PostgreSQL contains their expected
keys, sizes, and checksums but not their content.

Redis, BullMQ jobs, process counters, and ephemeral worker/component heartbeats
are reconstructable operational state, not backup authority. Do not make Redis
snapshots a prerequisite for recovery.

Configuration and secrets are deliberately excluded. Preserve `API_KEY_PEPPER`,
`WEBHOOK_SECRET_ENCRYPTION_KEY`, authentication secrets, Stripe/Groq keys, and
storage/database credentials in a separately controlled secret manager. An old
or different API-key pepper invalidates persisted API-key hashes. A missing or
different webhook encryption key makes stored signing secrets undecryptable;
AES-GCM fails closed and does not reveal plaintext.

Account deletion must also survive recovery to an older point in time. Keep an
external, access-controlled deletion journal outside the restored database,
compare it with the recovery point, and reapply newer requests before reopening
customer access. The concrete production journal, retention period, and owner
are unresolved launch decisions documented in `DATA_GOVERNANCE.md` and the
legal launch checklist.

## Recovery objectives

Verified local capability is a logical point-in-time dump and clean-database
restore. It is not continuous recovery. A reasonable initial production goal is
RPO 24 hours with daily verified backups and RTO four hours with a rehearsed
operator. These are operational targets, not guaranteed SLAs. Tighter targets
require managed snapshots and/or PostgreSQL WAL archiving outside Phase 24.

## PostgreSQL backup and integrity

PostgreSQL native tools are required. Set `POSTGRES_BIN` if they are not on
`PATH`; common PostgreSQL 15–18 Windows locations are detected automatically.

```text
pnpm backup:db
pnpm backup:db -- --output D:\private-backups\2026-08-10.dump
pnpm backup:verify -- --manifest D:\private-backups\2026-08-10.dump.manifest.json
```

`backup:db` uses `pg_dump --format=custom`, refuses overwrite, writes through a
temporary file, and exits non-zero on failure. Its sidecar manifest contains a
format version, UTC timestamp, application version, logical database name,
migration count and migration-set SHA-256, archive size/SHA-256, and an explicit
statement that secrets were excluded. Passwords are supplied to child tools
through `PGPASSWORD`; URLs and credentials are never command arguments or log
output. `backup:verify` rejects missing, malformed, truncated, or corrupt data.

Keep the dump, manifest, artifact set, and an out-of-band copy of the migration
source revision together on encrypted storage with restricted operator access.
Use encrypted volumes, provider-side object encryption, and managed KMS rather
than custom application encryption.

## Guarded database restore

Provision a separate empty database and provide its URL only through the
environment. The restore command refuses the configured application database,
requires an explicit acknowledgement, verifies the backup first, and checks
that the target contains no application tables.

```text
set RESTORE_DATABASE_URL=postgresql://.../new_empty_database
pnpm backup:restore -- --manifest D:\private-backups\2026-08-10.dump.manifest.json --confirm-empty-target
```

Restore uses `pg_restore --exit-on-error --no-owner --no-privileges`, checks
connectivity, and runs `prisma migrate status` against the restored target. It
does not create, drop, clean, or overwrite a database and never performs an
automatic production restore.

## Artifact backup and consistency

For the local driver, the backup command copies every database-referenced
object under its original relative storage key into a new directory and writes
`artifacts.manifest.json`. Existing destinations are refused.

```text
pnpm backup:artifacts -- --output D:\private-backups\artifacts-2026-08-10
pnpm backup:artifacts:verify -- --manifest D:\private-backups\artifacts-2026-08-10\artifacts.manifest.json --checksum
pnpm backup:artifacts:verify -- --checksum
```

Verification is read-only. It reports sanitized ID suffixes for missing, size,
or checksum mismatches and counts unreferenced local objects. It never deletes
objects. S3-compatible mode verifies database-referenced objects and exports an
expected-object manifest; copying/versioning the bucket remains the storage
operator's provider-neutral responsibility. No signed URLs or credentials are
written to manifests.

## Redis loss and durable queue reconciliation

After starting an empty Redis, run:

```text
pnpm reconcile:all
```

The command sequentially repairs the browser Run queue, notification delivery
queue, and outbound webhook delivery queue from PostgreSQL. Each subsystem is
attempted even if another fails, and the overall command fails if any subsystem
failed. Browser job IDs and delivery IDs preserve idempotency; terminal Runs are
not recreated. Scheduling resumes from durable Schedule/Occurrence state when
the scheduler starts. Existing worker lease recovery handles a lost machine.

## Ordered restore runbook

1. Stop admission, schedulers, and workers; record the incident and recovery
   point.
2. Provision a new empty PostgreSQL database and verify the dump checksum.
3. Restore with the guarded command and confirm migration status.
4. Restore artifact objects to a separate root/bucket and run consistency
   verification before switching storage configuration.
5. Restore the original cryptographic secrets from the secret manager. Do not
   copy secrets from ordinary backup media.
6. Start an empty Redis and run `pnpm reconcile:all`.
7. Start the dashboard and check protected health/readiness.
8. Start browser, scheduler, notification, and webhook workers; check Phase 23
   operations telemetry and queue backlog.
9. Verify representative authenticated records and a harmless Run before
   reopening admission.
10. Review deletions and external billing/provider state newer than the backup.

## Migrations, retention, and deletion implications

Before a production migration, create and verify a backup and record `prisma
migrate status`. After migration, validate Prisma and health/readiness. Do not
attempt an automatic down migration; restore into new infrastructure and switch
over when an irreversible migration fails.

Retention is dry-run by default:

```text
pnpm backup:retain -- --directory D:\private-backups --keep 7 --days 30
pnpm backup:retain -- --directory D:\private-backups --keep 7 --days 30 --apply
```

Only checksum-valid dump/manifest pairs older than the age threshold and beyond
the retained count are candidates. The newest valid backup and invalid evidence
are never deleted. Production policy should align retention with legal deletion
requirements and storage snapshots.

Restoring an older backup can resurrect an account or artifact deleted after
the recovery point. The current AccountDeletion record is included only when it
already existed at backup time; it is not an external tombstone. Maintain a
separate access-controlled deletion journal, review requests since the recovery
point, reapply them after restore, and keep backup retention bounded. Phase 25
may formalize longer-lived compliance evidence.

## Failure scenarios

- Redis lost: start empty Redis, reconcile all queues, then start workers.
- Worker host lost: Phase 22 heartbeat/lease recovery requeues durable Runs.
- PostgreSQL lost: restore a verified dump, restore secrets/artifacts, reconcile
  queues, then verify readiness.
- Artifact storage partly lost: database and textual results remain readable;
  consistency verification reports missing objects and artifact reads fail
  safely without deleting metadata.
- Older database recovery point: expect bounded data loss up to the RPO and
  explicitly reconcile deletions, Stripe state, and durable queues.
- Corrupt backup: checksum verification stops restore before database mutation.

## Runtime evidence and limitations

The Phase 24 disposable drill created a user, Agent, successful and queued Runs,
Run event, usage entry, schedule, notification/webhook delivery metadata,
encrypted webhook secret, and local artifact. A PostgreSQL 18 custom-format
dump with all 18 migrations passed checksum verification and restored into a
separately named empty database. All representative rows and relationships were
present. The artifact was copied to a separate root; deliberate removal was
detected and the restored object then passed size/checksum verification. A
corrupt copied dump was rejected before restore. A wrong webhook encryption key
failed closed and the original key recovered access.

With isolated empty Redis, reconciliation recreated browser Run, notification,
and webhook jobs. A second reconciliation reported no missing browser jobs and
did not create duplicate job identities. The production dashboard started
against the restored database and returned HTTP 200 health/readiness. No fixture
password credential was created, so authenticated customer-session replay was
intentionally not exercised; protected data integrity was verified directly
through the restored Prisma connection. The disposable database, Redis,
artifact roots, source fixture, and processes were removed.

Continuous WAL archiving, managed snapshots, multi-region replication,
cloud-vendor bucket replication, automated secret escrow, legal hold, and
active-active recovery remain outside this phase.
