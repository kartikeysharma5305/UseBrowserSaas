# Public API v1

The personal-key API is rooted at `/api/v1`. It reuses the dashboard's authoritative ownership services, Run admission, quotas, BullMQ queue, cancellation, structured-result storage and artifact storage. It cannot mutate Agents, schedules, billing, accounts, credentials or notification preferences.

## Key security

Create and revoke keys from Settings or the session-authenticated `/api/api-keys` routes. A key resembles `bua_test_<prefix>.<secret>` in non-production and `bua_live_<prefix>.<secret>` in production. The complete value is returned once. Lists contain only name, non-authenticating prefix, scopes, status and timestamps.

PostgreSQL stores only an HMAC-SHA-256 digest. `API_KEY_PEPPER` is a separate server secret of at least 32 characters and is validated by development preflight. Authentication first selects the unique random prefix and then compares the digest in constant time. Keys expire or revoke immediately. Account deletion atomically revokes active keys before recoverable deletion work begins and later cascades their records.

Send keys only as `Authorization: Bearer <key>`. Query-string keys, malformed/multiple authorization values, sessions, expired/revoked keys and deleting/deleted users receive the same `401` response. Keys and authorization headers are never logged.

Scopes are `agents:read`, `runs:read`, `runs:create`, `runs:cancel`, `results:read`, and `artifacts:read`. There is no wildcard or administrative scope.

## Endpoints

- `GET /api/v1/agents`, `GET /api/v1/agents/{id}`
- `POST /api/v1/agents/{id}/runs`
- `GET /api/v1/runs`, `GET /api/v1/runs/{id}`
- `POST /api/v1/runs/{id}/cancel`
- `GET /api/v1/runs/{id}/result`
- `GET /api/v1/runs/{id}/artifacts`
- `GET /api/v1/artifacts/{id}`

Agent DTOs exclude owner IDs, execution/provider configuration, safety internals, schedule state and variable defaults. Run DTOs exclude workers, leases, queue identifiers, input/task snapshots, secrets and provider errors. Result responses return only validated/partial data plus safe validation errors; raw and parsed candidates are unavailable. Artifact metadata contains a versioned API download URL, never a storage key, local path or S3 URL.

## Run creation and retry safety

Run creation accepts a strict JSON object containing only declared `variables` and requires `Content-Type: application/json` plus an 8–128 character `Idempotency-Key` header. Task, model, timeout and execution policy cannot be selected by clients.

The idempotency identity is scoped to the API key and Run-create operation. PostgreSQL stores peppered key hashes, canonical request fingerprints and a 24-hour expiry. A deterministic `api-<reservation>` Run ID closes the crash window: retries reuse the same PostgreSQL Run and BullMQ job. Exact replays return that Run; a changed Agent or variables conflict with `409`. Run admission still enforces variables, deletion state, active limits, monthly quota, immutable safety/schema snapshots and usage ledger entries.

## Pagination, filtering and errors

Lists use descending `(createdAt, id)` opaque cursors. `limit` is 1–100. Agents support status; Runs support status, Agent ID and an optional date interval no wider than one year.

Errors use:

```json
{ "error": { "code": "INVALID_REQUEST", "message": "Safe public message." } }
```

Cross-owner resource requests return the same `404` as unknown IDs. Request bodies are content-type checked and bounded. Responses are private/no-store with MIME sniffing disabled. No permissive CORS headers are emitted.

## Rate limits

Redis 5-compatible `INCR`/`PEXPIRE` fixed windows enforce per-key, per-user and per-operation limits from the centralized plan catalogue. General reads fail open during a Redis outage so authorization remains available; Run creation, cancellation, result and artifact access fail closed with `503` and `Retry-After`. Rate limits supplement rather than replace plan/usage quotas. Per-user limits exceed per-key limits so one key does not immediately consume another key's allowance.

## Auditing and lifecycle

Minimal durable events record key creation/revocation and API Run admission/cancellation. They contain IDs and action names only—not headers, keys, tasks or variables. Broader security-event analytics remain future audit-platform work.

Runtime verification uses disposable users and keys. It covers one-time secret display/list redaction, scopes, owner isolation, idempotent/concurrent admission, changed-body conflict, status/result/artifact APIs, rate limiting, immediate revocation, deletion blocking and cleanup. A successful external model result is not required.

The source contract is [openapi-v1.yaml](./openapi-v1.yaml). Future phases may add OAuth applications, team/service identities, outbound webhooks and SDK generation without changing v1 key semantics.
