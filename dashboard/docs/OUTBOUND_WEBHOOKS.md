# Customer outbound webhooks

## Architecture

PostgreSQL is authoritative. `WebhookEvent` is an immutable logical event,
`WebhookDelivery` is one endpoint delivery or manual replay, and
`WebhookEndpoint` owns subscriptions and encrypted signing material. A separate
BullMQ queue named `outbound-webhook-deliveries` carries only
`{ version: 1, deliveryId }`. The standalone webhook worker re-loads all trusted
state, takes a PostgreSQL advisory lock and lease, and performs the request.

The browser Run queue and email-notification queue are not reused. A periodic
reconciler re-enqueues due or lease-expired database deliveries, making Redis
loss and worker restarts recoverable.

## Events and payloads

Supported subscriptions are `run.queued`, `run.started`, `run.succeeded`,
`run.failed`, `run.timed_out`, `run.canceled`, `schedule.triggered`,
`schedule.blocked`, and `schedule.failed`. `endpoint.test` is used only by the
test command. Events are created inside authoritative transition transactions.
Run ID plus transition, or scheduled-occurrence ID plus outcome, is the unique
logical identity, so retries do not create duplicate events.

Payload version 1 contains only event ID, type, version, creation time, and safe
Run/Agent/Schedule/occurrence IDs and status. It excludes tasks, variables,
results, URLs visited, artifacts, storage paths, provider errors, worker/queue
identifiers, credentials, billing data, and safety-policy internals. Clients use
the authenticated public API when they need result or artifact data.

## Secrets and signatures

Creation and rotation generate a `whsec_` value from 32 cryptographically random
bytes. The plaintext is returned once. At rest it is encrypted with AES-256-GCM
using a fresh 96-bit IV and the server-only, base64-encoded 32-byte
`WEBHOOK_SECRET_ENCRYPTION_KEY`; ciphertext, authentication tag, IV, safe prefix,
and key version are stored. Rotation invalidates the previous secret immediately;
pending deliveries use the current endpoint secret.

The exact transmitted canonical JSON bytes are signed with HMAC-SHA256 over:

```text
event_id.timestamp.raw_body
```

Headers are `Webhook-Id`, `Webhook-Timestamp`, and
`Webhook-Signature: v1=<hex>`. Retries and replays keep the same event ID and
payload but may use a fresh timestamp. Consumers should reject stale timestamps
and compare the locally calculated signature in constant time.

## Network and HTTP safety

Production endpoints require HTTPS. Credentials, fragments, unsafe schemes,
ambiguous numeric hosts, localhost, private/RFC1918, loopback, link-local,
carrier-grade NAT, documentation, benchmark, multicast, reserved IPv4, private
or link-local IPv6, metadata targets, DNS failures, and mixed public/private DNS
answers are rejected using the Phase 11 network primitives. DNS is checked again
before every attempt. Redirects are never followed.

Requests are POST JSON with no cookies, ambient authorization, API keys, custom
headers, user proxy, or redirect following. Payloads, total duration, and
discarded response bodies are bounded. Only status, duration, and a sanitized
failure code are persisted; response bodies are never stored.

For a controlled local drill only, a non-production process may set
`WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS=true`. This flag never permits arbitrary private
networks and is rejected as an HTTPS exception in production.

Application DNS checks cannot eliminate every resolver-to-connect race. Network
egress policy that permits only public HTTPS destinations remains recommended in
production as defense in depth.

## Retries, disablement, and recovery

2xx succeeds. Network failures, timeouts, 408, 429, and 5xx retry with bounded
exponential backoff. Redirects, most 4xx responses, invalid payloads, and
oversized responses fail permanently. Defaults are six attempts and automatic
endpoint disablement after six consecutive failed attempts. Success resets the
failure count. Disabling suppresses queued deliveries but never cancels Runs.

`pnpm dev:webhooks` starts the worker and `pnpm webhooks:reconcile` repairs missing
queue jobs. The worker also reconciles every ten seconds and shuts down cleanly.

## Management, replay, and plans

The Settings page supports create, event subscription editing, enable/disable,
delete, one-time secret copy/dismiss, rotation, test delivery, history, and replay.
All API and service queries include the authenticated owner. Cross-owner records
return the normal safe not-found response. Replay creates a new delivery sequence
for the same event and does not rerun an Agent. Test payloads contain no Run data.
Test and replay commands are Redis rate-limited and fail closed if Redis is
unavailable.

FREE has no endpoints. PRO permits five endpoints; INTERNAL permits twenty-five.
Command limits live in the centralized plan catalogue. Downgraded users retain
definitions and history but event creation produces no new deliveries until an
eligible plan is restored.

## Account deletion

Deletion immediately disables endpoints, suppresses delivery, and deletes the
endpoint rows and encrypted signing material in the same transaction that
revokes API keys. Queue jobs are removed best-effort, and stale jobs cannot send
because the worker re-checks database state. Product-data deletion removes the
remaining events and history without touching another user.

## Runtime verification

The controlled receiver drill exercises one-time secret display, exact body and
signature verification, test delivery, real queued/canceled Run events, replay
with stable event identity, 500/429 retries, response bound, timeout, automatic
disablement, production-mode loopback rejection, cross-user denial, deletion
suppression, and disposable-resource cleanup. No successful external model call
is required.

Future work may add workspace-owned endpoints, secret overlap during rotation,
customer-visible metrics, infrastructure egress pinning, and broader audit-log
integration. Inbound webhooks, webhook-triggered Runs, custom authentication,
and result payload push are intentionally outside Phase 14.
