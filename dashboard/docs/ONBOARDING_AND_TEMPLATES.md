# Templates and First-Run Onboarding

## Architecture

Phase 8 adds a server-owned, versioned starter-template catalogue and a durable
first-run checklist. Templates are source-controlled definitions, not database
execution records. Applying one creates an ordinary user-owned `Agent`; optional
"Create and test" then calls the existing Run-admission service and BullMQ path.
There is no template-specific execution pipeline.

`OnboardingState` stores only user UI state: visibility, dismissal/reopen and
completion timestamps, plus the last selected template ID. Checklist milestones
are derived from authoritative owner-scoped Agent, Run, Schedule and notification
preference records. The client cannot submit completed milestones.

## Catalogue and trust boundary

The initial catalogue contains eight bounded examples for content summaries,
availability/price/content monitoring, public research and public contact
collection. Each entry has a stable ID and version, suggested name and goal,
target-site guidance, expected output, safety notes and failure guidance.

Only `name`, `description`, `goal`, an HTTP(S) target and the create/test choice
are accepted from the browser. The model, browser settings, timeouts and step
limits are selected server-side. The selected template ID/version may be stored
as provenance, but runtime behavior never depends on it. Template APIs do not
return Agent configuration, model/provider details, user IDs, secrets or task
execution data.

Template safety guidance does not bypass robots rules, authentication,
authorization, site terms or privacy obligations. Templates do not include
credentials, anti-bot evasion, destructive actions or collection of sensitive
personal data.

## Plan-aware recommendations

Recommendations are clamped through the centralized plan catalogue. A FREE user
can browse and apply templates, but values above FREE execution limits are
reduced before Agent creation and the wizard explains the adjustment. PRO and
INTERNAL users receive their existing plan bounds. Templates do not contain
billing or Stripe logic.

## Onboarding behavior

- A genuinely new user sees the dashboard checklist and a template entry point.
- Existing users with an Agent or Run and no `OnboardingState` are not forced
  through new-user onboarding.
- Agent created, Run started and Run succeeded milestones come from database
  records. Scheduling and notification milestones link to their existing pages.
- The first successful Run durably completes and hides onboarding.
- "Skip for now" persists dismissal. Settings can persistently reopen it.
- Account deletion removes `OnboardingState` with the user's product data.

## Create-and-test and failures

Template creation uses the same owner-scoped Agent service as manual creation.
Create-and-test invokes ordinary trusted Run admission, so active-run limits,
monthly quota, account-deletion blocks, usage accounting and queue semantics are
unchanged. The worker receives the normal minimal Run payload and reloads trusted
state from PostgreSQL.

If admission fails, the Agent remains created and the UI provides a safe link to
retry from Agent details. If execution fails, the normal redacted Run detail is
used; templates do not expose provider responses, stack traces, task
configuration or secrets. Client busy state prevents repeated clicks while a
creation request is active. Server-side retry idempotency for Agent creation is
deferred.

## APIs and authorization

- `GET /api/templates`
- `GET /api/templates/[id]`
- `POST /api/templates/[id]/create-agent`
- `GET /api/onboarding`
- `PATCH /api/onboarding` with `DISMISS` or `REOPEN`

All routes require authentication. The authenticated API boundary reloads the
authoritative user row, including current plan and deletion state. Agent
ownership is never accepted from request data. Unknown template IDs and
cross-owner records use safe project-standard responses. Inputs are strict and
bounded with Zod.

## UI

`/dashboard/templates` provides responsive category filters, previews and links
into the existing Agent create page. The create page retains its manual flow and
shows a small template customization wizard only when a valid template query is
present. Desktop and mobile navigation include Templates. Loading, empty, error,
busy, successful creation, admission failure and execution failure states are
explicit.

## Commands and verification

```text
pnpm test:templates
pnpm phase8:test:runtime
```

Automated verification covers catalogue safety/versioning, plan clamping,
ordinary Agent and Run integration, admission failure, authoritative checklist
derivation, persistence, account deletion, API validation/authorization,
redaction and UI states.

The 2026-08-06 disposable runtime drill verified registration, new-user
onboarding, catalogue filter/preview, plan adjustment, ordinary Agent creation,
existing BullMQ admission, existing Run-detail navigation, authoritative Agent
and Run milestones, a safe failed-execution path, dismiss/reload/reopen,
pre-existing-user behavior, responsive mobile navigation, API redaction and
cross-user isolation. Both disposable accounts were submitted through the real
account-deletion workflow after the drill.

The real create-and-test Run was admitted, started by the existing worker and
reached `FAILED` because the configured external model provider's daily token
quota was exhausted. The user-visible failure remained redacted. A successful
terminal Run and automatic successful-milestone completion therefore remain an
external runtime closure item; both behaviors are automated-test verified.

## Deferred work

Future work may add catalogue administration/version migration, analytics,
server-side idempotency keys for create retries, richer preview illustrations,
template search/favorites and more contextual onboarding. Those additions must
retain the server-owned execution configuration and ordinary Run path.
