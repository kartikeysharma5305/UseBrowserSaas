# Linux Browser Worker Deployment

The current multi-worker identity, health, drain, and lease-recovery contract is
documented in `WORKER_SCALING.md`. This guide retains the Linux-specific process
and cgroup examples.

## Build Order

Use a dedicated unprivileged service account and build the root engine before
the dashboard worker can become ready:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --dir dashboard install --frozen-lockfile
pnpm --dir dashboard prisma generate
pnpm --dir dashboard prisma migrate deploy
pnpm --dir dashboard build
```

The worker preflight requires `dist/agent/index.js`, PostgreSQL connectivity,
and Redis connectivity before it reports readiness.

## Services

Example units are provided in:

- `deploy/systemd/browser-dashboard.service`
- `deploy/systemd/browser-worker.service`

Place nonsecret and secret runtime settings in
`/etc/browser-use/dashboard.env` with permissions restricted to the service
account. Do not put credentials in unit files.

The worker unit uses:

- `KillSignal=SIGTERM` so the Node worker pauses intake and starts its bounded
  shutdown.
- `TimeoutStopSec=45s`, which exceeds the default 30-second worker grace.
- `KillMode=mixed`, which signals the main process first and lets systemd clean
  any remaining cgroup descendants after the stop timeout.
- `ConditionPathExists=/opt/browser-use/dist/agent/index.js` to make the root
  build prerequisite visible.

Do not use broad `pkill` commands. Playwright browser roots may have a distinct
process group, but they remain in the systemd service cgroup.

## Linux Verification

The process helper reports PID, PPID, PGID, SID, RSS, CPU, and attributable
Playwright Chromium processes:

```bash
pnpm phase4:linux:snapshot [worker-pid]
```

The real-runtime harness is Linux-only and creates disposable authenticated
users, agents, Runs, queue jobs, artifacts, and browser processes:

```bash
PHASE4_LINUX_DRILL=graceful pnpm phase4:linux:runtime
PHASE4_LINUX_DRILL=crash pnpm phase4:linux:runtime
PHASE4_LINUX_DRILL=backpressure pnpm phase4:linux:runtime
PHASE4_LINUX_DRILL=concurrency2 pnpm phase4:linux:runtime
PHASE4_LINUX_DRILL=retry pnpm phase4:linux:runtime
PHASE4_REDIS_CONFIG=/path/to/isolated.conf \
  PHASE4_LINUX_DRILL=redis pnpm phase4:linux:runtime
```

`phase4-linux-fail-first-worker.ts` refuses production mode and requires an
internally supplied target Run ID. It is not reachable from public request
data.

Use `pnpm phase4:linux:cleanup` after an interrupted harness. It deletes only
users with the harness email prefix and its generated artifact directory.
Queue cleanup must target the isolated verification Redis instance.

## Verified Semantics

Ubuntu 24.04 WSL2 verification on 2026-07-25 observed:

- `SIGTERM` invoked the worker handler, paused intake, aborted after the
  configured 3-second test grace, cleared the lease, and exited in 3.154
  seconds.
- One active browser root and all seven Chromium processes exited with no
  tracked orphan.
- `SIGKILL` stopped the actual worker process; Chromium exited, the replacement
  did not claim before lease expiry, and the same Run recovered at attempt 2.
- Concurrency 1 peaked at one active/two waiting and one browser session.
- Concurrency 2 peaked at two active/one waiting and two browser sessions.
- A dedicated Redis instance with AOF and `appendfsync everysec` restarted
  after a 3.082-second interruption without duplicate execution or lost job
  identity.

The initial Groq account reached its daily quota during closure. After the
credential was replaced, the fail-first drill reused one Run, returned attempt
1 to delayed retry without browser work, and completed attempt 2 successfully
with real Groq and Chromium. It persisted one PNG, one terminal completion
event, unique sequences, and left no queue work or browser process behind.

## Production Artifact Storage

Set `ARTIFACT_STORAGE_DRIVER=s3` for horizontally deployed workers and provide
the server-only S3 region, bucket, and credentials. Use `S3_ENDPOINT` and
`S3_FORCE_PATH_STYLE` only for the selected compatible provider. Keep the
bucket private; the authenticated dashboard API is the retrieval boundary.

Before worker readiness:

```bash
pnpm artifacts:health
pnpm artifacts:migrate
```

Review the migration dry-run, then use its guarded `--apply` form as documented
in `OBJECT_STORAGE.md`. Deploy the schema and dashboard code before migrating
existing local rows. Mixed providers are supported during the transition.

Run retention and usage reconciliation as separately supervised maintenance
jobs. Both default to dry-run:

```bash
pnpm maintenance:cleanup-artifacts
pnpm usage:reconcile
```

Review counts and reclaimed/unmetered bytes before adding `--apply`. Plan
quotas are enforced from PostgreSQL, so the dashboard and worker must run the
same application release and catalogue.
