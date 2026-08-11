# Data Retention Policy — Draft for Legal Review

**Operational draft, not legal advice.** Current artifact retention is FREE 7
days, PRO 30, INTERNAL 90, plus the implemented downgrade grace. Run/event and
structured-result rows, usage, notifications, webhook history, API audit,
billing and deletion evidence do not currently have general timed cleanup;
account deletion handles user-owned product data. Legal/accounting/security
durations must be selected before public launch.

Backups use configurable count/age retention, preserve the newest valid backup,
and require an external deletion journal. Logs are deployment-controlled and
must stay redacted. Production owners must document cleanup schedules,
financial/security exceptions, backup retention, incident holds and deletion
reconciliation without claiming a legal-hold system that is not implemented.
