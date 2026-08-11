# Closed beta

Phase 27 supports a controlled cohort of 5–25 invited users. Set `BETA_MODE=true`, a deployment-specific `APP_RELEASE_ID`, `SUPPORT_CONTACT_EMAIL`, and a conservative `BETA_MAX_ACTIVE_USERS`. Ordinary signup is rejected while login, password recovery, legal pages, existing users, export, and deletion remain available.

Invites are email-bound, expiring, revocable, and single-use. A 256-bit token is shown only when created; PostgreSQL stores its SHA-256 digest and a non-authenticating prefix. Claim and capacity races use PostgreSQL advisory transaction locks. Signup still records the current Terms, Privacy, and Acceptable Use versions.

Beta users receive FREE or explicitly selected PRO limits, never INTERNAL. Initial beta use is not converted into a paid subscription and creates no production Stripe charge. FREE is suitable for manual testing; controlled PRO allows existing scheduling/webhook limits. All Phase 20 safety controls, Phase 21 budgets, plan quotas, queue backpressure, and worker concurrency remain authoritative.

States are ACTIVE, SUSPENDED, and ENDED. Suspension retains data and read/privacy access but blocks manual, scheduled, and public-API Run admission plus webhook tests/replays. Ending access pauses schedules and removes a MANUAL beta plan grant to FREE; it never charges or deletes the user. Reactivation restores future admission subject to the ordinary plan and cost controls.

Feedback stores only bounded text, category, optional owned Run ID, safe route context, status, and release ID. It rejects common secret markers and never copies task or provider payloads. Feedback is included in user export and removed during deletion.

The internal beta view exposes the invitation/activation funnel, bounded recent feedback, user state, and 24-hour Run outcomes, retries, structured-result validity, duration, and sanitized failure groupings. Provider/model failures are classified independently from platform health; provider availability is not a core health dependency.

Recommended Phase 28 starting gates are operator-configurable: at least 10 active testers and 100 representative completed Runs; at least 90% success for supported tasks; under 5% timeout and infrastructure failure; no unresolved critical security/data-loss issue; no persistent queue corruption; current restore drill; completed legal/business launch decisions; and production capacity observed under representative load. These are starting decision thresholds, not promises or SLAs.
