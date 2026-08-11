# Beta operations

## Daily workflow

Use `/dashboard/internal/beta` with an INTERNAL session. Confirm the release ID and capacity, review new feedback and funnel drop-off, then correlate only sanitized Run IDs/codes in the existing operations dashboard. Never ask testers to paste credentials or task secrets.

For a report: identify release; inspect the owned Run and safe failure code; classify provider, browser/navigation, safety, timeout, quota/cost, cancellation, worker/infrastructure, or structured validation; reproduce with non-sensitive data in staging; record a workaround; change feedback to REVIEWING and then RESOLVED/WONT_FIX after retest.

- SEV-1: security, data loss, or platform-wide impact. Disable admission with `EXECUTION_ENABLED=false`, drain workers, preserve evidence, follow backup/restore and security response procedures.
- SEV-2: a major beta capability is unusable. Stop affected admissions or suspend a risky tester, inspect workers/queues, and prioritize a staged fix.
- SEV-3: individual Run or feature defect. Triage and provide a workaround.
- SEV-4: usability or minor issue. Track for normal beta iteration.

Existing controls remain canonical: execution kill switch, worker drain, operations/queue metrics, API-key revocation, webhook disablement, account suspension, migration preflight, backups, and disaster recovery. A FAILED account deletion still blocks admission.

Create invites only below the capacity ceiling. Deliver the one-time URL manually if email is disabled; beta lifecycle email campaigns are intentionally deferred. Revoke unused invites. Suspend without deleting when investigating abuse. End access only after communicating the transition; it pauses schedules and never converts the tester to paid service.

Release changes require a staging pass, backup before migration, additive/backward-compatible schema review, release ID, rollback path, and a short changelog entry. No unreviewed destructive migration is permitted during beta.
