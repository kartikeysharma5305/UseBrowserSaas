# Phase 27E Bug Sweep Report

Date: 2026-08-12

This report contains sanitized evidence from focused automated tests and disposable local runtime drills. It does not contain credentials, invite tokens, API keys, webhook secrets, or complete customer identifiers.

## Summary

- P0: 0 reproduced
- P1: 1 reproduced and fixed
- P2: 4 reproduced and fixed
- P3: 0 product defects fixed
- External limitations: no new live Stripe charge, real email, S3/MinIO, or destructive production restore was attempted

## BUG-27E-001

- Severity: P2
- Area: runtime QA / closed-beta authentication
- Title: disposable browser drills could no longer register after closed-beta enforcement
- Reproduction: run the Phase 11, Phase 13, Phase 14, Phase 6D, Phase 8, Phase 9, or Phase 20 browser drill with `BETA_MODE=true`; the script opened `/register` without an invite and timed out waiting for the dashboard.
- Expected: the drills exercise current invite-gated registration through the real browser flow.
- Actual: the product correctly rejected open signup, but the stale drills reported unrelated failures.
- Root cause: the runtime scripts predated Phase 27 closed-beta registration.
- Fix: added a shared disposable invite helper that stores only an invite hash and performs the normal browser registration with legal acceptance; migrated the exercised drills to it.
- Files changed: `dashboard/scripts/runtime-beta-registration.ts` and affected runtime scripts.
- Test/runtime verification: Phase 11, Phase 13, Phase 14, Phase 6D, Phase 9, and Phase 20 browser runtime drills passed after migration.
- Status: FIXED

## BUG-27E-002

- Severity: P2
- Area: public API rate-limit verification
- Title: Phase 13 drill assumed an obsolete 80-request PRO limit
- Reproduction: run Phase 13 against the current centralized plan catalogue; no 429 occurs within the script's fixed 80-request loop because the PRO limit is 300 requests/minute.
- Expected: deterministic verification of the configured limit without excessive requests.
- Actual: false failure and needless external requests.
- Root cause: duplicated historical limit in the verifier.
- Fix: read the authoritative plan limit, seed only the disposable key's current Redis bucket at that limit, and send one real request to verify `429 RATE_LIMITED`.
- Files changed: `dashboard/scripts/verify-phase13-runtime.ts`.
- Test/runtime verification: all Phase 13 runtime assertions passed, including one-time plaintext, hash-only storage, ownership, idempotency, limiting, revocation, deletion, and cleanup.
- Status: FIXED

## BUG-27E-003

- Severity: P2
- Area: outbound-webhook runtime verification
- Title: Phase 14 retry fixtures no longer exceeded production-safe defaults
- Reproduction: run Phase 14 with defaults; the 4 KiB response is below the current 64 KiB bound and the 1.5 second delay is below the current 10 second timeout. Loopback is also correctly blocked unless explicitly enabled for the local receiver drill.
- Expected: controlled fixtures exceed the configured bounds while production SSRF defaults remain unchanged.
- Actual: false oversized/timeout failures.
- Root cause: stale fixed fixture values and missing documented drill environment.
- Fix: retained secure product defaults and executed the controlled local drill with the supported temporary minimum timeout/body/backoff configuration and loopback explicitly enabled only for the worker drill.
- Files changed: beta-registration integration in `dashboard/scripts/verify-phase14-runtime.ts`; no production webhook safety control changed.
- Test/runtime verification: all 15 Phase 14 assertions passed, including exact-body signing, retry, timeout, response bound, auto-disable, production private-target rejection, ownership, redaction, and cleanup.
- Status: FIXED

## BUG-27E-004

- Severity: P2
- Area: scheduling runtime cleanup / beta capacity
- Title: Phase 6D drill leaked disposable users and exhausted beta capacity
- Reproduction: repeated Phase 6D runs left disposable `@example.invalid` users; 32 abandoned Phase 6B/6C/6D fixtures accumulated and four remained ACTIVE, filling the configured five-user beta capacity with the retained reliability account.
- Expected: disposable runtime accounts are removed after the drill.
- Actual: subsequent legitimate invite registrations returned 403 because capacity was genuinely full.
- Root cause: the Phase 6D `finally` block closed clients but did not delete its disposable accounts.
- Fix: removed only the identified Phase 6B/6C/6D disposable fixtures and added Phase 6D user cleanup in `finally`.
- Files changed: `dashboard/scripts/verify-phase6d-ui-runtime.ts`.
- Test/runtime verification: beta ACTIVE count returned to one retained reliability account; Phase 6D passed all 15 assertions and Phase 9 registration subsequently succeeded.
- Status: FIXED

## BUG-27E-005

- Severity: P1
- Area: browser worker / timeout containment
- Title: late Playwright rejection after browser timeout crashed the worker and all of `dev:all`
- Reproduction: admit a short-budget variable Run. Page readiness reached its operation deadline, cleanup closed the browser, then an already-running DOM `page.evaluate` rejected with `Target page, context or browser has been closed`. Node treated the detached rejection as fatal; the browser worker exited and `concurrently --kill-others` terminated dashboard, scheduler, notification worker, and webhook worker.
- Expected: the Run reaches one bounded terminal state; late cleanup rejection is contained; worker remains available.
- Actual: a single timed-out Run terminated the local service stack.
- Root cause: Playwright work can reject after cooperative abort has won the operation race and browser cleanup has started; the late rejection escaped the Run promise boundary.
- Fix: arm a short cleanup window whenever the execution service closes browser resources and install worker-level containment for only the known Playwright closed-page/context/browser rejection during that window. All unrelated unhandled rejections retain fail-fast behavior.
- Files changed: `dashboard/src/lib/browser/engine.ts`, `dashboard/src/lib/worker/unhandled-browser-rejection.ts`, and `dashboard/src/worker/browser-run-worker.ts`.
- Test added: `test/worker-browser-rejection-containment.test.ts` covers accepted shutdown messages, unrelated rejection denial, and the armed time window.
- Runtime verification: replayed the same Phase 9 scenario; the Run reached controlled terminal `FAILED`, immutable input and redaction checks passed, the worker remained alive, and the remainder of the drill completed.
- Status: FIXED

## Coverage and findings

- Authentication: invite-gated signup, legal acceptance, login POST transport, credential-query cleanup, session access, and account cleanup runtime verified. Product rejection of uninvited signup remained enforced.
- Ownership/security: two-user denial runtime verified for browser policy, schedules, API resources, outbound webhooks, and structured-result resources. Private-network and unsafe-scheme execution remained blocked.
- Agent variables: definitions, required values, immutable Run snapshot, scheduling invalidation, deferred SECRET values, and redaction runtime verified.
- Execution: hierarchical operation timeout tests and real worker containment passed. The recent Wikipedia and YourStory NVIDIA runtime successes remain the representative external execution evidence; no extra provider calls were needed for this sweep.
- Scheduling: FREE restriction plus INTERNAL create/edit/pause/resume/skip/run-now/delete, occurrence linkage, mobile layout, response redaction, and cross-user denial runtime verified.
- Public API: key lifecycle, ownership, idempotency, rate limiting, revocation, and deletion runtime verified.
- Outbound webhooks: signing, retry classes, response/time bounds, replay, disable, SSRF, ownership, redaction, and cleanup runtime verified with a controlled local receiver.
- Structured results and execution safety: existing runtime drills passed during this sweep.
- Scaling/races: two worker processes, duplicate delivery, unique accounting, scheduler admission, cancellation, and graceful drain runtime verified with isolated Redis.
- Backup/DR: seven nondestructive disaster-recovery tests passed; no restore was run against the main development database.
- Billing/account deletion/notifications/legal/observability/responsive routes: covered by the dashboard regression and focused contract suites; destructive or external-provider variants were not repeated in Phase 27E.

## Remaining limitations

- Full manual multi-tab SSE interaction, real email delivery, S3/MinIO object cleanup, and a fresh Stripe sandbox lifecycle were not rerun; prior phase evidence and automated contracts were preserved.
- The local Node 20 process emits an AWS SDK future-support warning. It is not a current functional failure, but deployment should use the repository's supported/current Node release.
- Public target URLs are intentionally present in safe Run timeline data. Variable values and SECRET values remain excluded.
