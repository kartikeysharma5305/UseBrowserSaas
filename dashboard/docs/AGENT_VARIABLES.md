# Agent Variables and Reusable Runs

## Architecture and data model

Phase 9 extends the existing Agent, Run admission, BullMQ and worker pipeline. It
does not introduce another execution path.

`AgentVariable` stores an Agent-owned ordered definition with a stable key,
label, description, type, required flag, optional non-secret default and bounded
validation constraints. `Agent.variableVersion` increments when definitions are
replaced. The `(agentId, key)` database constraint prevents duplicates.

`Run.inputSnapshot`, `Run.executionTask` and
`Run.executionTargetWebsite` are written in the same admission transaction as
the queued Run. They are immutable execution inputs. The BullMQ job remains
exactly `{ version, runId }`; the worker claims the Run and uses its stored task
instead of recomputing from the current Agent. Retries therefore reuse the same
snapshot.

`Schedule.variableValues`, `variableVersion` and
`configurationErrorCode` store the Schedule's normalized non-secret values and
definition version. Defaults are materialized when the Schedule is saved, so a
later default edit does not silently change its future Runs.

## Types and validation

Supported definition types are `TEXT`, `URL`, `NUMBER`, `BOOLEAN` and `SECRET`.
Keys start with a lowercase letter, contain only lowercase letters, numbers and
underscores, and are at most 48 characters. Reserved execution/identity names,
duplicates and more than 20 definitions are rejected.

Text values support bounded minimum/maximum lengths. Numbers support finite
minimum/maximum values. URLs must resolve to HTTP or HTTPS. Booleans normalize
from boolean values or the strings `true` and `false`. Nested data, arrays,
non-finite numbers, unknown keys and oversized values are rejected by the shared
Zod and resolver boundary.

## Interpolation policy

The centralized resolver replaces only declared `{{variable_name}}` tokens in
the Agent goal and target website. `\{{` preserves a literal opening brace.
Values are inserted as plain text in one pass: replacement text containing
another placeholder, JavaScript, shell syntax or template syntax is not
evaluated recursively.

Unknown placeholders, missing required or used values, invalid types, unsafe
target protocols and oversized rendered inputs fail before a Run row is
created. Arbitrary Agent configuration JSON is never interpolated. The final
target must be an HTTP(S) URL.

## Manual Runs and immutable history

`POST /api/agents/[id]/run` accepts a bounded `variables` object. The server
reloads authoritative Agent definitions, validates supplied keys, applies
defaults, renders the input and persists the snapshot before enqueueing. The
client cannot submit a rendered task. Quota, active-Run, account-deletion and
queue checks remain the established admission behavior.

Run APIs expose only the safe public snapshot. Run detail labels each value as
supplied or defaulted. Historical snapshots do not change when the Agent goal,
target, defaults, definitions, Schedule or source template changes.

## Scheduled Runs

Schedule create/edit accepts a non-secret `variables` map and uses the same
resolver. Normalized values and defaults are snapshotted on the Schedule.
Scheduled admission resolves only from those stored values and writes an
ordinary immutable Run snapshot.

When an Agent definition edit makes stored Schedule values invalid, the
Schedule is paused, `VARIABLE_CONFIGURATION_INVALID` is stored, and a safe
`AGENT_BLOCKED` occurrence is recorded without creating a Run. The user must
edit its values before resuming. Existing admitted Runs are never changed or
canceled.

The explicit Schedule “Run now” command stays outside occurrence advancement
but uses that Schedule's stored values through ordinary Run admission.

## Agent and template behavior

The create page and Agent detail support adding, removing and reordering
definitions, selecting types, required/default behavior and bounded constraints.
Detected placeholders must have declarations. Removing or changing definitions
warns that affected Schedules can be paused; database locks serialize the Agent
edit with Schedule admission/deletion boundaries.

Phase 8 templates can declare variables. The webpage summarizer, availability
checker, job researcher and news summary create ordinary Agents with useful
website and task inputs. Template provenance is informational only; execution
continues to depend solely on the ordinary Agent and Run records.

## Secret limitation and redaction

Secret definitions and password-form UX exist, but execution and scheduling are
intentionally rejected with a generic safe error. Secret defaults are forbidden.
This repository has no suitable encrypted credential store or secure
dashboard-to-worker secret channel, and Phase 9 does not invent weak encryption
or persist plaintext in Run/Schedule JSON.

Submitted secret values are not written to Runs, AgentEvents, notifications,
URLs or logs and are never returned. Public snapshot serialization defensively
masks any secret-shaped entry as `••••••••`. Encrypted reusable credentials,
browser profiles and authenticated cookies remain deferred.

## APIs

```text
POST      /api/agents                    # definitions on creation
GET/PATCH /api/agents/[id]/variables     # owner-scoped definition management
POST      /api/agents/[id]/run           # { variables: { city: "Gurugram" } }
POST      /api/schedules                 # non-secret stored values
PATCH     /api/schedules/[id]            # edit future stored values
```

All routes derive the owner from the authenticated authoritative user row. They
accept no user ID, reject cross-owner Agent/Schedule access with the standard
safe response, use strict bounded validation and return no provider or Prisma
errors.

## Commands and runtime evidence

```text
pnpm test:variables
pnpm phase9:test:runtime
```

The disposable runtime drill on 2026-08-06 verified durable text/URL/number/
boolean definitions, missing-value rejection without a Run, a genuinely QUEUED
snapshot while BullMQ was paused, Agent editing before queue resume, worker use
of the unchanged stored task, safe Run API values, a variable-enabled template,
stored Schedule values, definition-change Schedule blocking/history,
cross-owner denial and secret rejection without database/API/event/notification/
log leakage. The real worker claimed the Run; the configured external provider
then returned a quota failure. Provider success was not required for the
snapshot drill. Both disposable users were removed through account deletion.

## Deferred work

Encrypted credentials, key rotation, secure worker delivery, reusable cookies,
authenticated browser profiles, expression languages, nested values, workflows
and user-created template marketplaces are outside Phase 9.
