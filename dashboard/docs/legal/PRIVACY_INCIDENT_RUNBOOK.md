# Privacy Incident Runbook

This operational runbook is not legal advice and specifies no universal
notification deadline.

1. Identify and timestamp the report; restrict discussion to the incident team.
2. Preserve relevant redacted logs, audit events, database/backup evidence and
   access history without altering originals.
3. Contain exposure: disable admission/integrations, isolate hosts, revoke
   sessions/API keys and rotate affected database, auth, webhook, Stripe, model,
   email and storage secrets as applicable.
4. Determine affected systems, time range, data categories, users, providers
   and whether data was accessed, changed, lost or merely exposed.
5. Engage the incident owner, privacy/security contacts, qualified counsel and
   affected providers. Notification obligations and timing depend on facts and
   jurisdiction.
6. Recover from verified state, reconcile Redis/queues and deletions, validate
   readiness and monitor for recurrence.
7. Record decisions, communications and a postmortem; assign technical and
   operational remediation without placing secrets in tickets or reports.
