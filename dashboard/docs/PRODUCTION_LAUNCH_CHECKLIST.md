# Production launch checklist

Every item is a hard launch gate unless an accountable owner records a reviewed
exception. Phase 26 does not mark deployment-specific or legal decisions done.

## Technical

- [ ] Release built from a reviewed, pinned lockfile and identifiable revision.
- [ ] Production environment values pass `pnpm production:preflight`.
- [ ] All migrations are current; no destructive compatibility gap exists.
- [ ] A current database/artifact backup and recent clean restore drill pass.
- [ ] PostgreSQL TLS, PITR, connection budget, runtime role and migration role reviewed.
- [ ] Redis 6.2+, persistence, `noeviction`, TLS/private networking and capacity reviewed.
- [ ] Private production object bucket and retention/lifecycle verified.
- [ ] Canonical DNS/TLS, exact trusted origins, redirects, HSTS and CSP verified.
- [ ] Worker capacity/drain settings measured; queue reconciliation is clean.
- [ ] Health/readiness green and metrics/operations accessible only internally.
- [ ] Secret scan, dependency audit triage, egress rules and incident kill switch reviewed.
- [ ] Staging smoke passed on the exact release with synthetic data only.
- [ ] Read-only production smoke passed after deployment.

## Business and legal

- [ ] Legal entity and privacy/security contacts are real and monitored.
- [ ] Qualified counsel reviewed Terms, Privacy, AUP, Cookies and retention drafts.
- [ ] Governing law, age eligibility and refund/cancellation policies are decided.
- [ ] Stripe live products/prices/webhook and customer-facing descriptions approved.
- [ ] Production subprocessors, contracts, data regions and international flows confirmed.
- [ ] Production retention settings and external deletion journal process approved.

## Operations

- [ ] Named deployment, backup, incident-response and on-call owners are available.
- [ ] Alert routing, escalation contacts and status/customer communication plan tested.
- [ ] Secret continuity/rotation custody is documented without exposing values.
- [ ] Rollback compatibility and the latest backup identifiers are understood.
- [ ] Email sender domain authentication and staging-recipient safeguards verified.
- [ ] Browser-worker resource ceilings and provider spending controls approved.

Public launch remains blocked while any mandatory legal/business gate is
unresolved, even when all technical tests pass.
