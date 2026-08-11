# Data Governance

This document records technical behavior, not legal certification or advice. It
is designed to support a closed beta and requires qualified legal review before
public launch.

## Verified inventory

| Category            | Purpose and storage                                                                                                          | Sensitivity                                            | Retention/deletion/export                                                                                                                                                                                 | Provider exposure                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Identity            | PostgreSQL User, Account and Session records authenticate users; name/email are optional/profile values                      | Personal/confidential                                  | Sessions expire or are invalidated; account deletion removes auth accounts/sessions and anonymizes the retained user tombstone; export includes profile but never accounts, passwords, sessions or tokens | Auth/hosting/database operator                                                                           |
| Agent configuration | PostgreSQL Agent, variable definitions, goals, target URLs, safety policies and output schemas operate automations           | Can contain customer/confidential content              | Retained until user edit/deletion; export includes definitions but redacts SECRET defaults                                                                                                                | Groq/model provider receives execution content when a Run needs it; target sites receive browser actions |
| Runs                | PostgreSQL immutable input snapshots, status/timestamps, events, results, structured results and retained URL/context fields | Potentially sensitive customer and target-site content | Run/event/result rows currently persist until account deletion; artifact objects follow plan retention; export is bounded to 5,000 Runs and uses the public redacted snapshot                             | Model provider, target websites, storage provider for artifacts                                          |
| Artifacts           | Local or S3-compatible private objects plus PostgreSQL metadata/checksum                                                     | Potentially highly sensitive screenshots               | FREE 7, PRO 30, INTERNAL 90 days plus current downgrade grace; deletion removes objects before metadata; export contains an owner-protected download manifest, not storage keys                           | Configured storage provider                                                                              |
| Usage               | PostgreSQL counts, execution time, steps, storage bytes and provider-reported tokens                                         | Low-to-moderate operational data                       | Durable ledger; financial/legal retention requires review; account deletion currently removes user-linked usage through cascade; export quantities are strings                                            | Database/hosting; Stripe sees billing, not this ledger directly                                          |
| Billing             | PostgreSQL Stripe customer/subscription references, price/status/period and webhook processing state                         | Financial metadata, no card data                       | Minimal subscription state is retained/anonymized according to deletion workflow; accounting retention requires legal decision                                                                            | Stripe                                                                                                   |
| Notifications       | PostgreSQL service notification, payload and email delivery state/recipient                                                  | Personal/service data                                  | No marketing system exists; deletion workflow emits mandatory lifecycle notice and product data follows deletion; export omits recipient duplication and provider message IDs                             | Configured email provider such as Resend when enabled                                                    |
| API keys            | PostgreSQL prefix, HMAC hash, scopes, audit and lifecycle metadata                                                           | Security-sensitive                                     | Plaintext shown once and never retained; deletion revokes/removes records; export contains metadata only, never hash/plaintext                                                                            | Application/database only                                                                                |
| Outbound webhooks   | Endpoint URL, encrypted signing secret, event/delivery state                                                                 | Confidential/security-sensitive                        | Endpoint and recoverable signing material are destroyed when deletion begins; export includes URL/history/prefix only                                                                                     | Customer-configured endpoint/network                                                                     |
| Operations          | Redacted structured logs, WorkerInstance state, bounded metrics and queue state                                              | Operational; logs can contain bounded IDs              | Process counters/Redis are ephemeral; durable health records/log retention is deployment policy                                                                                                           | Hosting/logging operator                                                                                 |
| Backups             | Native PostgreSQL dumps and artifact copies                                                                                  | Full-system sensitive                                  | Configurable dry-run retention; old backups can predate deletion and require an external deletion journal                                                                                                 | Backup/storage operator                                                                                  |

Data not currently stored includes payment-card details, marketing consent or
campaign data, analytics identifiers, API-key plaintext after creation, and
SECRET variable values (secure credential support is not implemented).

## Retention matrix

| Record                           | Current technical rule                                           | Launch decision                                    |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Artifacts/screenshots            | Plan-based 7/30/90 days plus downgrade grace                     | Confirm production cleanup schedule                |
| Runs/events/structured results   | No timed row deletion; account deletion removes Agent-owned rows | Define product/legal duration                      |
| Usage ledger                     | Durable until account deletion                                   | Confirm accounting/abuse requirements              |
| Notifications/webhook deliveries | Durable until owning records/account deletion                    | Define operational window                          |
| API audit/security records       | Durable until account deletion or explicit expiry where modeled  | Define security retention                          |
| Billing records/webhook state    | Minimal operational state; deletion anonymizes/cancels           | Obtain tax/accounting review                       |
| AccountDeletion                  | Durable minimal status on anonymized user                        | Confirm privacy evidence duration                  |
| Backups                          | Operator-configured count/days; newest valid preserved           | Establish production schedule and deletion journal |
| Logs                             | Deployment-controlled; application redacts secrets               | Establish host/log-provider limits                 |

No financially or security-relevant timed deletion was invented in Phase 25.

## Export, deletion, and common request support

`POST /api/account/export` produces a rate-limited, no-store JSON download with
a versioned manifest. It is owner-derived from the authenticated session,
bounded to 8 MiB and fixed record limits, and excludes credentials, hashes,
sessions, encrypted webhook material, object keys and internal operations.
Deletion-pending/failed/completed accounts cannot export. Artifact content is
available separately through existing owner-scoped downloads while retained.

Account deletion immediately revokes API keys, disables/deletes webhooks, stops
schedules, cancels Runs, removes artifact objects before metadata, cancels the
Stripe subscription where enabled, removes product/auth data, invalidates
sessions and anonymizes the user. Failures persist and resume. Old backups can
resurrect later deletions; a separately stored, access-controlled deletion
journal is required because an in-database tombstone would roll back too.

| Common request        | Technical capability                               | Operational dependency                                        |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Access/portability    | Bounded JSON export and artifact download manifest | Privacy support for oversized exports                         |
| Deletion              | Recoverable Settings workflow                      | Stripe/storage availability; external backup deletion journal |
| Correction            | Agent/settings edits; limited profile support      | Support process for identity changes not exposed in UI        |
| Restriction/objection | Execution kill switch and account controls         | Legal/operator review; not a self-service legal workflow      |
| Consent withdrawal    | Current-version acceptance ledger                  | Determine legal basis and effect with counsel                 |

These are technical supports for common privacy requests, not assertions of a
universal legal entitlement.

## Cookies, minimization, and providers

Better Auth sets essential HttpOnly session/security cookies with SameSite and
production Secure policy. Theme preference can use browser storage. The current
repository contains no analytics, advertising or marketing tracking, so it does
not load a non-essential-cookie banner. Consent controls are required before
future tracking is enabled.

Run snapshots use public redaction for SECRET entries; SECRET defaults are not
allowed. Logs recursively redact credentials and known tokens. Export omits
provider payloads, raw execution configuration, internal errors, recipient
duplication and storage keys. Transactional notifications are not marketing and
must not be repurposed without a separate lawful product decision.

Actual integrations are documented in `legal/SUBPROCESSORS.md`. Hosting,
database, object-storage and email vendors remain deployment-dependent.

## Phase 25 runtime evidence

On 2026-08-10 an isolated Redis-backed `pnpm dev:all` drill registered two
disposable users. All four legal pages were public, signup exposed the required
links, the three current document versions were recorded idempotently, and an
obsolete Terms version was detected. The owner-only export contained the
owner's Agent and portable Run result, excluded the control user's marker and
complete API-key hash, encrypted webhook secret, signing secret, and storage
keys, and returned `429` after the documented hourly limit. The control export
contained only control-owned data. Account deletion completed durably and the
deleted session's next export returned `401`; the control user's normal product
record remained unchanged. The drill removed its disposable users and stopped
its processes.

This verifies the local application path, not a production legal determination,
production backup deletion journal, external support SLA, or vendor contract.
