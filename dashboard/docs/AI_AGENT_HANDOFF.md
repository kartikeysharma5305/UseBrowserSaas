# AI Agent Handoff

## Current phase
Phase 6B — Subscriptions, Billing, and Account Lifecycle (backend foundation)

## Exact objective for this session
Implement Phase 6B backend foundation in small, verifiable steps:
1. Implement billing customer creation and reuse service.
2. Implement entitlement synchronization service (authoritative subscription -> User plan state).
3. Implement server-side API routes (Checkout, Portal, Status, Webhook) using existing billing library and Prisma schema.
4. Implement idempotent, ordered webhook processing and subscription synchronization.
5. Add focused tests for billing config, customer creation, webhook verification, and entitlement rules.
6. Update environment example and backend documentation stubs.

This session will not implement UI changes, account deletion flows, reconciliation CLI, or runtime end-to-end Stripe verification unless test-mode credentials are provided.

## Files about to be modified in this session
- dashboard/src/lib/billing/customer.ts (new)
- dashboard/src/lib/billing/entitlement-sync.ts (new)
- dashboard/src/app/api/billing/checkout/route.ts (new)
- dashboard/src/app/api/billing/portal/route.ts (new)
- dashboard/src/app/api/billing/status/route.ts (new)
- dashboard/src/app/api/billing/webhook/route.ts (new)
- dashboard/test/billing/ (new tests)
- dashboard/.env.example (update)
- dashboard/docs/BILLING_AND_SUBSCRIPTIONS.md (new)
- dashboard/docs/AI_AGENT_HANDOFF.md (this file will be updated incrementally)

No existing migration files will be edited. If a schema gap is found that prevents safe implementation, work will pause and the handoff will document the precise missing field and a single additive migration will be proposed.

## Current Git status (working tree summary)
- Many modified files exist in the working tree (uncommitted changes). Key modified items include: README.md, dashboard/.env.example, dashboard/README.md, dashboard/package.json, dashboard/prisma/schema.prisma, numerous app and component files under dashboard/src/app and dashboard/src/components, and the dashboard billing library files are currently present.
- Untracked files/directories include: dashboard/deploy/, dashboard/docs/, dashboard/prisma/migrations/20260725170000_phase6b_billing_subscriptions/, and many dashboard/src/lib/* skeletons.

Full git status was captured and saved in the session log. Work will proceed on top of the current working tree. No commits will be made until a coherent implementation group completes and its tests pass.

## Current billing scaffold state (authoritative summary)
- Stripe SDK present: dependency "stripe" in dashboard/package.json
- Prisma schema contains billing enums and models: PlanCode, PlanSource, BillingProvider, Subscription, BillingWebhookEvent, AccountDeletion, and fields such as User.stripeCustomerId, Subscription.stripeSubscriptionId (unique), Subscription.stripeCustomerId, stripePriceId, status, currentPeriodStart/End, cancelAtPeriodEnd, lastStripeEventCreatedAt, lastStripeEventId.
- Migration folder dashboard/prisma/migrations/20260725170000_phase6b_billing_subscriptions exists in repo (do not modify).
- Billing library present at dashboard/src/lib/billing with modules: config.ts, stripe-client.ts, price-catalogue.ts, types.ts, access.ts. These provide config validation, Stripe client factory, plan-price mapping, status mappings, and helper policy for INTERNAL protection.
- No App Router API routes for billing currently exist (checked for app/api/billing/* — none found).

## Implementation sequence (small groups)
Group A (this session first group):
  A1. Add billing customer service (customer.ts) that reuses/creates Stripe customer and persists stripeCustomerId on User if not present. Ensure race-safe upsert using DB transaction and unique constraints. Unit tests for customer creation.
  A2. Add entitlement synchronization service (entitlement-sync.ts) that accepts Stripe subscription object and does transactional upsert of Subscription row and updates User.planCode & planSource via chooseUserPlanAfterStripeUpdate. Implement ordering protection using lastStripeEventCreatedAt and lastStripeEventId fields.

After A completes and tests for A pass, continue Group B:
  B1. Implement server API routes: checkout, portal, status, webhook. Keep synchronous bounded processing in webhook that calls entitlement-sync.
  B2. Add tests for routing behavior and webhook signature verification (mock Stripe client where needed).

Group C:
  C1. Update dashboard/.env.example and create dashboard/docs/BILLING_AND_SUBSCRIPTIONS.md stub.
  C2. Run focused verification commands: prisma validate/generate, typecheck, and run billing tests.

Stop and update handoff after each group. Do not proceed to the next group if critical tests fail.

## Current blockers and risks
- Working tree contains many uncommitted changes — ensure commit strategy is coordinated. This session will stage and commit only coherent changes related to the billing backend foundation when each group passes tests.
- Stripe secrets are required to exercise runtime webhook/Checkout end-to-end; test-mode will be documented but not required for unit tests.
- Next.js App Router raw-body handling must be implemented carefully for webhook signature verification. Will use the recommended Next.js pattern for reading raw body in server route.

## Files inspected earlier (relevant)
- dashboard/prisma/schema.prisma
- dashboard/prisma/migrations/20260725170000_phase6b_billing_subscriptions/migration.sql
- dashboard/src/lib/billing/config.ts
- dashboard/src/lib/billing/stripe-client.ts
- dashboard/src/lib/billing/price-catalogue.ts
- dashboard/src/lib/billing/types.ts
- dashboard/src/lib/billing/access.ts
- dashboard/package.json

---

Group A (in-progress): billing customer service and entitlement-sync implemented.

Files created in Group A:
- dashboard/src/lib/billing/customer.ts — getOrCreateStripeCustomerForUser(userId) with deterministic idempotency and race-safe upsert.
- dashboard/src/lib/billing/entitlement-sync.ts — syncStripeSubscriptionToLocal({ eventId, eventCreatedAt, subscription }) to upsert Subscription and update User plan transactionally with ordering protection.

Group A validation (in this session):
1. Added unit tests for billing config and price-catalogue: test/billing-config.test.ts.
2. Ran focused tests: `pnpm exec vitest run test/billing-config.test.ts` — tests passed (2 tests).
3. Ran Prisma client generation: `pnpm --dir dashboard exec prisma generate` — completed.
4. Ran dashboard TypeScript check: `pnpm --dir dashboard exec tsc --noEmit --incremental false` — TypeScript passed for new files.

Status: Group A implementation files created and focused tests passed for config/price-catalogue. Type checking and Prisma client generation completed successfully.

Next steps (Group A completion):
1. Add unit tests for customer service and entitlement-sync (mocking Prisma and Stripe as needed).
2. Run the focused test suite and dashboard typecheck again.
3. Commit Group A changes with clear commit message and Co-authored-by trailer.

After Group A validation completes and changes are committed, continue with Group B (API routes) as previously described.



## Files that must not be reverted
- dashboard/docs/AI_AGENT_HANDOFF.md

## Completion checklist
- [ ] Audit recorded in this handoff file
- [ ] Prisma schema inspected
- [ ] Better Auth inspected
- [ ] Plan/usage/quota modules inspected
- [ ] Account deletion inspected
- [ ] Findings recorded


(End of initial audit stub — will be updated as inspection proceeds.)
