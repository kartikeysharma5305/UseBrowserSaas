# Account lifecycle

## Deletion policy

Authenticated users start deletion from **Settings** by typing `DELETE`. The API
derives the account only from the authenticated session; it never accepts a
user ID from the browser. A durable `AccountDeletion` record makes retries
safe after an interrupted request.

Deletion blocks new runs, requests cancellation for running work, cancels and
removes queued jobs through the existing run-cancellation path, then deletes
private artifact objects through the configured local/S3 storage abstraction
before deleting their metadata. Agents and product data are removed. Sessions
and auth accounts are removed, preventing future login. The user remains as an
anonymized tombstone so the operation and minimum billing evidence remain
auditable; no Stripe invoice or payment history is deleted.

When Stripe billing is enabled, an active subscription is canceled without an
automatic refund. A failed external or storage action marks the deletion as
failed with a provider-neutral error and a subsequent owner request resumes
the same durable record. Run admission remains blocked while deletion is
pending or failed. Cancellation state is retained as minimal billing evidence,
while the user profile and customer mapping are removed atomically with durable
completion. Late Stripe events and reconciliation cannot restore that mapping.
No other user's runs, jobs, objects, or records are selected by this workflow.

The database tombstone is not sufficient after restoring a backup taken before
the request. Operations must maintain a separate, access-controlled deletion
journal and reapply requests newer than the restored recovery point. See
`DATA_GOVERNANCE.md` for the verified deletion and rights matrix. The journal's
owner, retention, and production system remain launch decisions requiring
legal and operational approval.

## Operational notes

Use `GET /api/account/delete` as the owner-scoped status endpoint. Deploy the
additive `20260803010000_phase6b_account_deletion_recovery` migration before
enabling this feature on an existing database. Rollback is application-level:
disable the deletion control; do not remove the durable columns while pending
operations exist.

Focused tests cover confirmation, create-or-resume semantics, admission
blocking, queued/running cancellation routing, object-before-metadata deletion,
session invalidation, Stripe cancellation without refund creation, and durable
failure recording. Production retention/anonymisation policy still requires
legal and accounting review; this implementation does not claim compliance.

## Sandbox runtime verification

On 2026-08-05, a newly registered disposable user was given one Agent, a
terminal Run and event, two disposable local artifacts, a delayed BullMQ job,
an active session, and a sandbox Stripe trial subscription. A separate control
user had its own Agent, Run, event, session, and local artifact.

The authenticated endpoint rejected an invalid phrase. The first valid request
created one `AccountDeletion`, canceled the queued Run through the normal
cancellation path, removed its delayed BullMQ job, and blocked new admission.
A deliberately invalid disposable local-storage key then produced a persisted,
sanitized `FAILED` state; admission remained blocked. After replacing only that
test object with a valid local object, another authenticated request resumed the
same deletion record and completed. Both local objects disappeared before their
metadata, product data was removed, the Stripe subscription was canceled with
no new refund, retained billing state was canceled and profile-free, sessions
became unauthorized, the original credentials could not log in, and the
control user's records and object were unchanged.

This environment used `ARTIFACT_STORAGE_DRIVER=local` and had no configured
S3/MinIO credentials, so remote-object deletion was not runtime exercised.
An actual worker-owned RUNNING Run was also not manufactured against the shared
development worker; its cancellation-request path remains automated-test
verified. These environment-specific omissions do not affect the completed
local, queue, billing, authentication, isolation, or recovery drills.
