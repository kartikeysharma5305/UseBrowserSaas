# Platform security

Phase 26 production configuration enforcement, TLS/origin rules, secret
continuity, and launch gates are documented in `DEPLOYMENT_ENVIRONMENTS.md` and
`PRODUCTION_LAUNCH_CHECKLIST.md`.

Phase 20 adds production-oriented abuse controls around the existing authorization, queue, browser-safety, public-API, and webhook boundaries. PostgreSQL remains authoritative for ownership and Run admission; Redis holds only short-lived rate counters.

## Threat model

The exposed risks are credential stuffing and account enumeration; signup, login, and reset spam; stolen sessions or API keys; CSRF; Run and browser-process flooding; queue exhaustion; expensive Agent configurations; oversized or deeply nested input; cross-user access; SSRF through browser navigation or outbound webhooks; webhook test/replay amplification; secrets in logs; compromised Stripe/webhook credentials; malicious schemas; dependency compromise; and loss of Redis during abuse. Controls assume an attacker can fully control request bodies, URLs, headers, API keys they own, and Agent instructions. A compromised application host, database superuser, or upstream dependency remains outside application-layer containment and requires credential rotation and infrastructure response.

## Central policy and rate limits

`src/lib/security/policy.ts` is the server-only catalogue for body/JSON complexity limits, auth limits, the public API pre-auth ceiling, webhook command ceilings, Run burst/backlog ceilings, idempotency-record capacity, and the execution kill switch. Higher product plans may raise product quotas, but cannot bypass these fixed security ceilings.

Authentication POSTs are wrapped before Better Auth. Signup, login, and configured reset routes use both a network bucket and a SHA-256-normalized identifier bucket. No email, password, or token is put in a Redis key. Limits expire after one minute; failures return a generic `429`. Redis failure fails closed with a sanitized `503`. One identifier hitting its limit does not exhaust the much larger network bucket for unrelated identifiers. Password reset and verification resend are not currently product-enabled; their known reset route names are protected if enabled. Better Auth owns credential verification and enumeration-safe authentication responses.

Public API requests retain per-key, per-user, and operation/plan limits, with a fixed pre-authentication IP ceiling before key lookup. Key verification remains HMAC plus constant-time comparison, malformed query-string credentials are rejected, deleting accounts and revoked/expired keys are blocked, and request bodies/pagination are bounded. Idempotency keys and bodies are bounded, records expire after 24 hours, and expired records for a key are purged on its next Run request. Redis rate-limit failure is fail-closed for the pre-auth boundary and for sensitive API operations.

Webhook test and replay commands retain plan limits and now also have fixed security ceilings. Delivery retry counts, batches, payload sizes, and timeouts remain bounded from Phase 14.

## Run and queue abuse

Every manual, API, template, and scheduled Run passes through the same `PrismaRunProducer` transaction. After account-deletion and ownership checks, a central database-backed admission check enforces:

- `EXECUTION_ENABLED` (enabled unless explicitly `false`);
- no more than 20 newly admitted Runs per user per minute;
- no more than 8 per Agent per minute;
- no more than 10 queued Runs per user.

The existing one-active-Run-per-Agent, plan active limits, monthly quotas, max duration/steps, and BullMQ global backlog limit remain separate and authoritative. Rejections create neither a Run nor usage charge. Scheduler occurrences become durable blocked history under shutdown/rate/backlog responses. Setting `EXECUTION_ENABLED=false` blocks only new admission; queued/running jobs are neither deleted nor silently discarded. Worker concurrency is independently bounded to 1–10, retries/backoff are bounded, and BullMQ job IDs remain deterministic.

## Requests, sessions, CSRF, headers, and CORS

Cookie-authenticated JSON routes require `application/json`, reject declared or actual bodies over 64 KB before JSON validation, and reject excessive nesting/field count. Authentication uses 16 KB, public API 32 KB, and webhook management 32 KB. Zod retains endpoint-specific string, collection, schema, variable, and pagination bounds.

Better Auth uses a seven-day server session, daily renewal, HttpOnly session cookies, production Secure cookies, SameSite cookie protection, and explicit non-wildcard trusted origins. Account deletion invalidates sessions and API keys; logout uses Better Auth invalidation. Application cookie-auth mutations additionally require an exact same-origin `Origin` and safe `Sec-Fetch-Site`. Better Auth routes keep its native origin/CSRF checks; Stripe inbound webhooks and bearer `/api/v1` routes are intentionally outside cookie CSRF middleware. The application does not emit permissive CORS headers and never combines wildcard origins with credentials.

All routes receive a CSP with same-origin defaults, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, and minimal Next.js-compatible inline script/style allowances. Development alone adds `'unsafe-eval'` because Next.js development source maps and hydration require it; production explicitly omits it. Routes also receive `DENY` framing, `nosniff`, no-referrer, and restrictive Permissions Policy. HSTS is emitted only from production builds, which must be served behind HTTPS.

## Network, artifacts, and secrets

Phase 11 browser navigation and Phase 14 webhooks share the established public-resolution primitive: HTTP(S)-only parsing, private/special/metadata address rejection, mixed DNS answer rejection, and redirect revalidation. Webhooks additionally require HTTPS outside an explicit development-only loopback mode. Production egress should still deny private, link-local, metadata, and control-plane networks at the firewall/container layer.

There are no product upload endpoints. Browser downloads/uploads remain disabled by default. Artifact identifiers are owner-scoped, storage keys are generated rather than accepted from callers, screenshot filenames are generated, MIME types are allowlisted/sniffed, sizes are bounded, and public API artifact reads use retrieval rate limits.

The logger recursively redacts sensitive keys (authorization, cookies, passwords, sessions, API keys, Stripe/webhook/encryption secrets and credentials), known token forms inside strings, arrays, and nested errors while preserving ordinary run IDs, codes, and status fields. Provider payloads and Agent secret values must never be logged.

## Operations and incident response

Commands:

```text
pnpm test:security
pnpm security:audit
pnpm security:secrets
pnpm security:migrations
```

`SECURITY_TRUST_PROXY_HEADERS=true` is safe only behind a proxy that overwrites forwarded-IP headers. During an execution incident set `EXECUTION_ENABLED=false` in every dashboard/scheduler admission process and restart/redeploy them; workers may continue draining established jobs. Rotate Better Auth, API-key pepper, Stripe, webhook encryption/signing, database, Redis, object-store, and model-provider credentials according to the affected boundary. The secret scan reports file paths and pattern classes only, never matched values. Migration integrity rejects edits to tracked historical migrations.

## Residual and deferred risks

CAPTCHA, MFA/SSO, manual suspension UI/state, full administrator tooling, SIEM/audit-log integration, malware scanning, container/browser sandboxing, and automated fraud classification remain deferred. Manual restriction belongs with Phase 19 administration rather than a hidden Phase 20 user-state model. Distributed limits require Redis; deliberate fail-closed behavior can temporarily reject authentication/API requests during an outage. CSP retains Next.js-compatible `'unsafe-inline'`; a nonce-based CSP is a future tightening. Infrastructure egress and secret-manager enforcement are deployment responsibilities.

## Sanitized Phase 20 verification

The controlled local drill verified `dev:all` dashboard/worker/scheduler/notification/webhook readiness; browser-hydrated signup/login via POST with no credentials in the resulting URL; legacy sensitive-query cleanup; identifier-scoped login cooldown with an unrelated login still accepted; cross-origin cookie mutation rejection and same-origin success; 413 oversized-body rejection; Run burst rejection without a Run; dashboard emergency shutdown with no Run; a durable scheduled occurrence recorded as `PLAN_BLOCKED`/`EXECUTION_DISABLED` without a Run; re-enabled Run admission; valid bearer API access; account-deletion cleanup; and no disposable credential markers in runtime logs. A production build/server returned CSP without `'unsafe-eval'`, HSTS, anti-frame, `nosniff`, and no wildcard CORS. Phase 11 and Phase 14 targeted network suites remained green.

The dependency audit reported 38 advisories (1 critical, 15 high, 20 moderate, 2 low). The critical `shell-quote` path is development-only through `concurrently`. High findings in commit/build tooling (`js-yaml`, `fast-uri`, PostCSS/nanoid), globbing, and the root engine are not reachable through dashboard request handling as configured. The `ip-address` advisory is transitive through the root MCP SDK; dashboard SSRF enforcement uses Node address parsing and its separately tested public-resolution policy. `adm-zip`/Axios are root-engine dependencies, while SaaS browser downloads are disabled. These remain upgrade work rather than unsafe Phase 20 lockfile churn; production dependency pruning and routine automated audit triage are recommended.
