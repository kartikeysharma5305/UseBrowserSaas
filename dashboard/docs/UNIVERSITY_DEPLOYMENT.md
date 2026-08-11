# University project deployment

## Status

- Target release: `university-demo-2026-08-11-01`
- Public URL: **pending Railway deployment**
- Repository root: repository root (do not set Railway Root Directory to `dashboard`)
- Architecture: five Railway application services, Railway PostgreSQL, Railway Redis, and a private Railway Storage Bucket
- Qualified model: `nvidia_nemotron-3-ultra-550b-a55b`

No live service, database, storage bucket, domain, demo account, or deployed Run is claimed until the runtime checklist below is completed.

## Railway services

Connect the same GitHub repository and branch to five services. For each service, set the indicated Config File Path in Settings; paths are repository-relative.

| Service | Config File Path | Start command |
| --- | --- | --- |
| `web` | `/dashboard/deploy/railway/web.json` | `pnpm start:dashboard` |
| `browser-worker` | `/dashboard/deploy/railway/browser-worker.json` | `pnpm start:worker` |
| `scheduler` | `/dashboard/deploy/railway/scheduler.json` | `pnpm start:scheduler` |
| `notification-worker` | `/dashboard/deploy/railway/notification-worker.json` | `pnpm start:notifications` |
| `webhook-worker` | `/dashboard/deploy/railway/webhook-worker.json` | `pnpm start:webhooks` |

Only `web` receives a public Railway domain. Databases and workers remain private. The web health check uses `/` because operator health/readiness routes deliberately return 404 without an operator bearer token. Verify those protected routes separately with `pnpm production:smoke`.

The browser worker uses `Dockerfile.browser-worker`, pinned to the Playwright 1.58.2 image matching the repository dependency. It includes Chromium and Linux libraries, sets the standard `/ms-playwright` browser path, and relies on the engine's existing container-safe Chromium arguments. Begin with one replica, `BROWSER_WORKER_CONCURRENCY=1`, at least 1 GB memory, and no public domain.

## Databases and storage

Add Railway PostgreSQL and Redis from the project canvas. On every application service use reference variables, not copied credentials:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Keep both services private. PostgreSQL remains authoritative; Redis is queue transport only. Before migration, enable Railway's managed PostgreSQL backup or produce a verified application backup. Set `MIGRATION_BACKUP_VERIFIED=true` only for the one-shot migration execution, run `pnpm production:migrate`, then remove it. This invokes `prisma migrate deploy`; never use `db push`, `migrate reset`, or `migrate dev` remotely.

Create one Railway Storage Bucket on the project canvas. Railway Buckets are private and S3-compatible. In the `web` and `browser-worker` service Variables tabs, map the bucket's Railway-provided variables to the application's existing names using reference variables (replace `Artifacts` if the bucket service has a different name):

```dotenv
ARTIFACT_STORAGE_DRIVER=s3
S3_ENDPOINT=${{Artifacts.ENDPOINT}}
S3_REGION=${{Artifacts.REGION}}
S3_BUCKET=${{Artifacts.BUCKET}}
S3_ACCESS_KEY_ID=${{Artifacts.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{Artifacts.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=false
```

Use `BUCKET`, not `RAILWAY_BUCKET_NAME`, for `S3_BUCKET`. New Railway Buckets use virtual-hosted URLs and therefore `S3_FORCE_PATH_STYLE=false`; if the Bucket **Credentials** tab explicitly reports path style for an older bucket, set it to `true` instead. Do not copy credential values manually when references are available. The browser worker writes objects and the web/API service reads and deletes them, so both require the mapping. The other workers do not require bucket credentials.

Railway Buckets do not support public-bucket mode. Artifacts remain private and are streamed only through the application's existing owner-authorized routes.

## Railway variables

Set these as shared variables for all five application services unless noted. Store secret values as sealed Railway variables.

### Shared required

- `NODE_ENV=production`
- `DEPLOYMENT_ENVIRONMENT=production`
- `DEPLOYMENT_INSTANCE_ID=university-demo-2026-08-11`
- `DATABASE_URL` and `REDIS_URL` service references
- `APP_BASE_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_TRUSTED_ORIGINS`: the exact HTTPS web origin
- `BETTER_AUTH_SECRET`: stable random value of at least 32 characters
- `API_KEY_PEPPER`: separate stable random value of at least 32 characters
- `WEBHOOK_SECRET_ENCRYPTION_KEY`: stable base64-encoded 32-byte key
- `OBSERVABILITY_TOKEN`: stable random value of at least 32 characters
- `EXECUTION_ENABLED=true`
- `NVIDIA_API_KEY` and `NVIDIA_NIM_ALLOWED_MODELS=nvidia_nemotron-3-ultra-550b-a55b`
- `SECURITY_TRUST_PROXY_HEADERS=true`
- `WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS=false`
- `LEGAL_ENTITY_NAME`, `PRIVACY_CONTACT_EMAIL`, `SECURITY_CONTACT_EMAIL`, and `SUPPORT_CONTACT_EMAIL`
- `APP_RELEASE_ID=university-demo-2026-08-11-01`
- `WORKER_BUILD_VERSION=university-demo-2026-08-11-01`
- `BETA_MODE=true`, `BETA_MAX_ACTIVE_USERS=5`, and `BETA_INVITE_LIFETIME_DAYS=7`
- `BILLING_ENABLED=false` and `EMAIL_ENABLED=false`

### Web only

- `NEXT_PUBLIC_APP_URL`: exact HTTPS web origin; this must exist before the build
- `PORT`: leave unset so Railway supplies it
- the six storage settings above, using Railway Bucket references

### Worker tuning

- Browser: the six storage settings above plus `BROWSER_WORKER_CONCURRENCY=1`, `WORKER_DRAIN_TIMEOUT_MS=30000`, `WORKER_HEALTH_HEARTBEAT_MS=15000`, `BROWSER_SHUTDOWN_TIMEOUT_MS=5000`, `NODE_OPTIONS=--max-old-space-size=4096`
- Notification: `NOTIFICATION_QUEUE_CONCURRENCY=1`; it may remain running with email disabled so in-app notifications and heartbeats remain available
- Webhook: `WEBHOOK_QUEUE_CONCURRENCY=1`
- Scheduler: one replica

### Optional and disabled for the university demo

- Groq is optional; never auto-fallback from NVIDIA.
- Stripe variables are unnecessary while `BILLING_ENABLED=false`.
- Resend variables are unnecessary while `EMAIL_ENABLED=false`.

## Deployment procedure

1. Provision PostgreSQL and Redis in one Railway project/environment.
2. Create the private Railway Storage Bucket and add its five credential references plus the driver/style settings to `web` and `browser-worker`.
3. Add shared variables and references; generate the web Railway domain and replace all URL variables with `https://<domain>`.
4. Run configuration-only preflight in a Railway shell: `pnpm --dir dashboard production:preflight -- --config-only`.
5. Verify a managed database backup, temporarily set `MIGRATION_BACKUP_VERIFIED=true`, run `pnpm production:migrate`, and remove the flag.
6. Deploy web, browser worker, scheduler, notification worker, and webhook worker.
7. Run `pnpm production:preflight` and then authenticated `pnpm production:smoke` with the protected operations token.
8. Confirm 20 migrations, one active browser-worker heartbeat, and scheduler/notification/webhook operational heartbeats.
9. Create a dedicated non-INTERNAL `UNIVERSITY DEMO` account through the invite flow. Assign a controlled beta entitlement; never store its password in this document.
10. Create a Wikipedia Agent using Nemotron, bounded steps/time, and a structured schema. Execute a real deployed Run and require `SUCCESS` plus preferably `VALID`.
11. Verify screenshots through the dashboard, private Railway Bucket persistence, cross-user denial, and survival after restarting the browser worker.

## Security and operational checks

Require Railway HTTPS, Secure cookies, HSTS, production CSP without `unsafe-eval`, exact trusted origins, protected operations/metrics, private databases and bucket, hidden unapproved models, and secrets absent from UI/logs. Preserve conservative quotas and safety controls. Do not copy local development data into Railway.

Use Railway managed database backups for the initial demonstration. The application `pnpm backup:db` workflow remains compatible when run from a controlled environment containing `pg_dump` and private database access. Do not test restore destructively against the deployed database.

## Runtime evidence ledger

| Check | Status |
| --- | --- |
| Railway project/services | Pending external account setup |
| PostgreSQL / Redis | Pending provisioning |
| Railway private bucket | Pending provisioning/credential references |
| Public HTTPS URL | Pending |
| Migration deploy | Pending |
| Protected readiness | Pending |
| Demo account/Agent | Pending |
| Real deployed Run / structured result | Pending |
| Railway Bucket artifact and restart verification | Pending |
| Managed backup | Pending |
