# Billing and Subscriptions

Phase 6B includes the server-side billing core, responsive billing UI,
reconciliation maintenance command, and account-lifecycle integration.

## Required environment variables (placeholders only)
- BILLING_ENABLED=false
- STRIPE_SECRET_KEY=
- STRIPE_WEBHOOK_SECRET=
- STRIPE_PRO_MONTHLY_PRICE_ID=
- STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:3001/dashboard/billing?checkout=success
- STRIPE_CHECKOUT_CANCEL_URL=http://localhost:3001/dashboard/billing?checkout=canceled
- STRIPE_PORTAL_RETURN_URL=http://localhost:3001/dashboard/billing

## Local test workflow (Stripe CLI)
1. stripe login
2. stripe listen --forward-to http://localhost:3001/api/billing/webhook
3. Copy the temporary webhook signing secret into STRIPE_WEBHOOK_SECRET in your .env and restart the server.
4. Use Stripe test cards to simulate payments.

## Implemented routes (server-only)
- POST /api/billing/checkout — create Stripe Checkout session (subscription mode)
- POST /api/billing/portal — create Stripe Customer Portal session
- GET  /api/billing/status  — return user billing status and actions
- POST /api/billing/webhook — Stripe webhook endpoint (signature verification and idempotent processing)

## Important notes
- Billing is opt-in via BILLING_ENABLED. Keep disabled in development unless testing with Stripe test keys.
- INTERNAL plan is protected and not overwritten by webhook events.
- Unknown Stripe price IDs do not grant PRO; they are recorded for reconciliation.
- Webhook events are recorded in BillingWebhookEvent and processed idempotently.
- All server-side modules live under dashboard/src/lib/billing/ and are server-only.

## Backend flow and public APIs

`POST /api/billing/checkout` requires an authenticated user and accepts only
`{ "plan": "PRO" }`. The server maps that plan to the configured price,
creates or reuses the trusted customer mapping, and returns only the hosted
Checkout URL. It never accepts customer IDs, price IDs, user IDs, or redirect
URLs from the client, and it does not grant entitlement before a webhook.

`POST /api/billing/portal` requires an existing trusted customer mapping and
returns only Stripe's hosted Portal URL. Portal capabilities (cancellation,
payment-method updates, invoices) must be enabled in the Stripe Dashboard.

`GET /api/billing/status` returns local plan/source, a safe subscription
summary, and available actions. It never exposes Stripe IDs, configured prices,
event IDs, processing errors, payment details, or secrets.

`POST /api/billing/webhook` is unauthenticated by design. It reads the exact
raw request body and verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`
before dispatching `checkout.session.completed`, subscription create/update/
delete, `invoice.paid`, and `invoice.payment_failed`. Never parse JSON before
signature verification.

## Consistency and entitlement policy

Webhook event IDs are primary keys in `BillingWebhookEvent`. Processed and
in-flight duplicates are skipped; FAILED events are atomically reclaimed on a
later Stripe retry. Subscription snapshots are ordered by Stripe's event
creation timestamp, so stale updates cannot undo a later deletion.

ACTIVE and TRIALING configured PRO subscriptions grant PRO. PAST_DUE retains
PRO only while Stripe's recorded current period remains valid; no custom grace
period is added. UNPAID, INCOMPLETE, INCOMPLETE_EXPIRED, PAUSED, and terminal
CANCELED states grant FREE. An active cancellation scheduled for period end
keeps PRO until that end. INTERNAL users retain INTERNAL even while their local
subscription record updates. Unknown prices are persisted as FREE and cause a
sanitized failed event for reconciliation; they never grant PRO.

Webhook processing is synchronous and intentionally bounded to database work
and a Stripe subscription retrieval. It performs no browser work. A future
production-hardening phase may move durable processing to a queue.

## Reconciliation

Run from the repository root. Dry-run is the default and Stripe remains
read-only:

```bash
pnpm billing:reconcile
pnpm billing:reconcile -- --apply
```

The bounded audit compares trusted customer, subscription, price, status, and
entitlement state; reports failed/stale webhook processing; protects INTERNAL;
and redacts identifiers to suffixes. Completed account-deletion tombstones are
excluded so reconciliation cannot restore a removed customer mapping. Apply
repairs only recognized safe local inconsistencies and repeated apply is
idempotent.

## Sandbox and production operations

Create a recurring Product Price in Stripe test mode and configure only its
`price_...` identifier. Start the application, then keep the listener open in a
separate terminal:

```bash
stripe login
stripe listen --forward-to http://localhost:3001/api/billing/webhook
```

Copy the listener's temporary signing secret into the uncommitted local env
file and restart. Configure the production webhook endpoint in Stripe
Dashboard and rotate keys/signing secrets using a controlled restart and
delivery check. Test-to-live cutover requires distinct live Product/Price IDs
and live-mode Portal/webhook configuration.

Incident recovery starts with Stripe delivery logs, local redacted webhook
state, and reconciliation dry-run. Replay failed events only after the cause is
understood. Never grant PRO from a Checkout redirect.

## Runtime verification

On 2026-08-05, Stripe test mode verified a disposable FREE user, hosted
Checkout and successful payment, signed webhook-backed PRO activation, hosted
Customer Portal creation, period-end cancellation persistence, continued PRO
access through the valid period, and exact-event replay idempotency. No Stripe
or local identifiers are retained here.

The same date also verified a genuine recurring payment failure with a new
Stripe test clock, disposable application user, clock-attached customer,
recognized PRO subscription, one-day trial, and a Stripe renewal-failing test
payment method. Advancing the clock through the first renewal produced an
actual `invoice.payment_failed` for that subscription. The CLI listener
forwarded the signed event; the application recorded it once as processed,
retrieved the authoritative subscription, persisted `PAST_DUE`, and retained
PRO only because the Stripe current period was still valid. Two exact signed
replays returned successfully without another webhook or subscription row.
This was not a failed Checkout, `payment_intent.payment_failed`, or a generic
CLI fixture.

The customer warning remains deliberately nonspecific: “Your payment needs
attention.” The status API returned the safe `PAST_DUE` summary and period
dates without Stripe IDs, invoice/payment objects, decline/card details,
provider error text, or secrets. `UNPAID` and ended states remain FREE by the
policy above, while INTERNAL remains protected. A final reconciliation
dry-run and two apply runs inspected the eligible subscriptions with zero
repairs, failures, or issues.

Restart `pnpm dev:all` after changing billing variables. Checkout return polling
is bounded and never grants entitlement locally; only verified Stripe state can
change the effective plan.

Stripe settings and retention require production legal, tax, and accounting
review. This document is operational guidance, not legal or accounting advice.
