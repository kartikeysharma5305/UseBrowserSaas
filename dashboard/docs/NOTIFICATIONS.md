# Durable Email Notifications

## Architecture

PostgreSQL is authoritative. `Notification` stores the user-visible, sanitized event and a globally unique deterministic idempotency key. `NotificationDelivery` stores the trusted destination snapshot and delivery lifecycle. `NotificationPreference` stores owner-controlled email categories. A separate BullMQ `notification-deliveries` queue carries only `{ version: 1, deliveryId }`; the standalone worker reloads all trusted content from PostgreSQL.

Event creation occurs at authoritative boundaries: guarded terminal Run persistence, scheduled-occurrence admission resolution, usage-ledger writes, verified Stripe webhook processing, and recoverable account deletion. Event persistence is not derived from UI polling and email failure never rolls back the underlying product transition.

## Events and preferences

Supported events are Run success, failure, timeout and cancellation; schedule quota/plan blocks and repeated processing/admission failures; monthly Run and retained-artifact storage thresholds; billing payment issue, cancellation scheduled and subscription ended; and account-deletion completed or blocked.

Defaults favor low volume: Run success and cancellation are off; Run failures/timeouts, schedule alerts, billing alerts, usage/storage alerts and account lifecycle are on. Global email delivery is on per user but remains inert unless the server sets `EMAIL_ENABLED=true`. Daily digest preference is stored but generation is deferred. Critical account-deletion completion/retry messages override the user category preference, though the server-wide email switch still suppresses them.

Thresholds are 80%, 95% and 100%, derived from the centralized plan catalogue. Keys include metric, user, UTC usage-period start and threshold, so a threshold is emitted once per period and resets naturally next month. Schedule alerts use schedule, reason and UTC day for a one-per-reason-per-day cooldown. Billing keys include the verified Stripe event identity, making webhook replay safe; payloads contain no Stripe identifiers or payment details. INTERNAL entitlement is excluded from Stripe-derived notification behavior.

## Delivery, retries, and recovery

The delivery ID is also the BullMQ job ID. A PostgreSQL advisory transaction lock and delivery lease serialize competing workers. `SENT`, terminal `FAILED`, and `SUPPRESSED` records are never sent again. Delivery uses five attempts by default with exponential BullMQ backoff; only a stable failure code and generic message are persisted. Resend receives the notification idempotency key so a provider response followed by a local crash remains provider-idempotent.

`pnpm notifications:reconcile` scans bounded due `PENDING` records and expired `PROCESSING` leases and recreates missing jobs. The notification worker performs the same bounded reconciliation at startup. PostgreSQL records therefore survive Redis loss or process restart.

## Templates and security

Templates are server-rendered HTML plus plain text. User-controlled Agent names are bounded and HTML escaped. Links are composed only from server-owned `APP_BASE_URL` and allowlisted relative dashboard paths. Payload sanitization accepts at most 20 bounded primitive fields. Task instructions, visited URLs, results, screenshots, provider responses, stack traces, card/payment details, secrets and complete Stripe identifiers are not stored or rendered.

The recipient is read from the authenticated database user. Clients cannot submit recipients or event types. History, preferences and read-state mutations always include the authenticated user ID in the service query; cross-user records produce the standard safe not-found response. The UI exposes only sanitized history and delivery state, never destination addresses or provider internals.

Account deletion snapshots the trusted email before anonymization. Completion notification creation and durable deletion completion share a database transaction; asynchronous delivery occurs afterward. A failed provider cannot block or undo deletion.

## Configuration and commands

Email-disabled startup requires no provider credentials:

```text
EMAIL_ENABLED=false
EMAIL_PROVIDER=development
EMAIL_FROM="Browser Use <notifications@example.invalid>"
APP_BASE_URL=http://localhost:3001
```

For production, set `EMAIL_PROVIDER=resend` and a server-only `EMAIL_API_KEY`. Never expose it through `NEXT_PUBLIC_*`. The development provider performs the full durable delivery transition without sending externally or logging message bodies.

```bash
pnpm dev:notifications
pnpm notifications:reconcile
pnpm test:notifications
pnpm dev:all
```

`dev:all` supervises the dashboard, browser worker, scheduler, notification worker and root-engine watcher. Production should supervise the notification worker independently and monitor terminal failed deliveries.

## Runtime verification (2026-08-06)

The complete `dev:all` topology started with the development provider after a
worker-shared import issue found by the first startup was corrected. A real
disposable browser Run reached a protected `FAILED`/`TIMED_OUT` terminal state
and produced one notification and one `SENT` development delivery. Replaying
terminal notification creation twice left one notification and one delivery.
A real one-time schedule downgraded to FREE produced a plan-blocked occurrence
and one cooldown-deduplicated alert. Disabling the Run-failure preference made
a second real terminal Run delivery `SUPPRESSED`. Owner history, cross-owner
read denial, and API redaction passed.

The notification queue was paused before a disposable account deletion. The
deletion reached durable `COMPLETED`; its mandatory completion delivery was
then processed through an intentionally failing provider and reached terminal
`FAILED` without changing deletion state. Reconciliation subsequently found
zero due deliveries missing jobs. Starting the standalone worker with email
disabled and no email credentials remained alive until the bounded verification
process stopped it. The local Redis server reports version 5.0.14.1; BullMQ
recommends Redis 6.2 or newer for deployment.

No real Resend request was made because no disposable external-provider
credential and recipient were supplied. Development-provider runtime behavior
is verified; external-provider delivery remains an environment verification.

## Operational policy and deferred work

Notification history and destination snapshots are retained as minimal operational evidence under the current account tombstone model; no statutory retention or email-law compliance is claimed. Production sender identity, unsubscribe/legal policy and retention require legal and operational review.

Daily digest generation, other channels, live push, marketing email, automatic schedule pausing and a richer notification center are deferred. External Resend delivery is optional for local verification when credentials are unavailable.
