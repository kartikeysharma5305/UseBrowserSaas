# Object Storage Operations

## Driver Contract

`ARTIFACT_STORAGE_DRIVER` selects `local` or `s3`. Local storage is intended
for single-node development. The S3 driver supports AWS S3, Cloudflare R2,
MinIO, and compatible private buckets through server-only credentials.

Both drivers enforce opaque keys, supported PNG/JPEG MIME types, the artifact
size limit, SHA-256 checksums, streaming reads, and idempotent deletion. The
database records the provider used for each object, so existing local rows
remain readable after the deployment default changes.

The download API performs session and ownership checks before selecting the
recorded provider. It streams the object through Next.js with private cache and
content-sniffing protections. Buckets must remain private; this release does
not use public URLs or presigned links.

## S3 Configuration

Required with `ARTIFACT_STORAGE_DRIVER=s3`:

```text
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
```

`S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` are optional compatibility settings.
Omit the endpoint for AWS S3. Credentials are validated at startup and are
never placed in browser bundles, API responses, logs, or migration output.

Validate connectivity and private access before enabling workers:

```bash
pnpm artifacts:health
```

## Local-to-S3 Migration

The migration tool is dry-run by default and processes only `LOCAL` metadata:

```bash
pnpm artifacts:migrate
pnpm artifacts:migrate -- --batch-size=100
```

Apply requires an explicit environment guard matching
`ARTIFACT_MIGRATION_ENVIRONMENT`:

```bash
pnpm artifacts:migrate -- --apply --environment=production
```

For each row, the tool uploads, verifies remote size with `HEAD`, conditionally
changes the database provider/checksum, and only then removes the local file.
Reruns skip migrated rows. A failed upload leaves the database and local file
unchanged.

Rollback before local deletion is simply switching the driver back to local.
After a row is committed to S3, rollback requires downloading the object to its
opaque local key and changing that row to `LOCAL`; do not bulk-edit provider
metadata without restoring bytes first.

## Retention

`pnpm maintenance:cleanup-artifacts` reports eligible rows without mutation.
Use `--apply` only after reviewing the output. Retention is derived from the
owner's current plan with a three-day downgrade grace, excludes active Runs,
deletes storage before metadata, and reports reclaimed bytes.

Remote objects can outlive metadata if a process dies between upload and the
database insert, or if account deletion cascades metadata without storage
cleanup. Monitor bucket inventory and add orphan-object reconciliation before
automated account deletion is enabled.
