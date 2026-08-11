# Deployment environments

Execution requires at least one server-only provider key: `GROQ_API_KEY` or `NVIDIA_API_KEY`. NVIDIA also requires `NVIDIA_NIM_ALLOWED_MODELS` containing only compatibility-proven catalogue IDs. Neither credential may use `NEXT_PUBLIC_`. See [NVIDIA_NIM_PROVIDER.md](./NVIDIA_NIM_PROVIDER.md).

Phase 26 defines an operational contract; it does not create cloud accounts or
authorize a public launch. `DEPLOYMENT_ENVIRONMENT` is explicit and must be
`development`, `staging`, or `production`. Staging and production run optimized
Next.js builds with `NODE_ENV=production`; product environment is never inferred
from a hostname.

| Concern    | Development               | Staging                      | Production                                    |
| ---------- | ------------------------- | ---------------------------- | --------------------------------------------- |
| Purpose    | Local iteration           | Production-like verification | Customer service                              |
| Data       | Disposable developer data | Synthetic/disposable only    | Customer data                                 |
| PostgreSQL | Local database            | Isolated staging database    | Isolated production database                  |
| Redis      | Local instance            | Isolated modern Redis        | Isolated modern Redis                         |
| Artifacts  | Local or MinIO/S3         | Private staging bucket/root  | Private S3-compatible bucket preferred        |
| Stripe     | Disabled or test          | Test mode only               | Live mode only when enabled                   |
| Email      | Disabled/development      | Disabled or provider sandbox | Resend with authenticated sender when enabled |
| URLs       | HTTP localhost            | HTTPS staging domain         | HTTPS canonical domain                        |
| Secrets    | Local-only                | Staging-only                 | Production-only, secret manager supplied      |

Never copy production users into staging. The two deployed environments must
not share database URLs, Redis instances, buckets, Stripe modes, auth secrets,
API-key peppers, webhook encryption keys, observability tokens, or provider
credentials. `assertStagingProductionIsolation` provides an offline comparison
primitive; the deployment owner must compare the actual secret-manager
assignments without printing them.

## Configuration contract

Safe templates are `.env.development.example`, `.env.staging.example`, and
`.env.production.example`. Populated files are not image inputs and should not
be committed. Generate independent random values with a cryptographically secure
secret manager or, locally, commands equivalent to `openssl rand -base64 32`.

Always required are PostgreSQL, Redis, canonical/auth origins, Better Auth
secret, API-key pepper, webhook AES-256-GCM key, and an observability token for
deployed environments. Groq is required only while execution admission is
enabled. Stripe, email, and S3 credentials are required only when their feature
is enabled. Production additionally requires reviewed legal entity and active
privacy/security contacts.

`API_KEY_PEPPER` is continuity-sensitive: changing it invalidates all existing
public API keys. `WEBHOOK_SECRET_ENCRYPTION_KEY` is continuity-sensitive:
changing it makes existing customer webhook signing secrets undecryptable.
Better Auth, database, Stripe, Redis, and storage secret rotation also require a
planned incident/deployment procedure. Never rotate them merely to redeploy.

The validator rejects non-HTTPS or localhost deployed origins, wildcard/missing
trusted origins, invalid secret sizes, enabled loopback webhooks, obvious Stripe
test/live mixing, unsafe staging email, and inconsistent redirects. The sole
`STAGING_LOCAL_DRILL=true` exception permits HTTP localhost only for the
disposable isolated runtime script; it never applies to production.

## Domain, TLS, cookies, and providers

Terminate trusted TLS before Next.js, forward the original HTTPS scheme, set
the exact canonical domain in all app/auth/Stripe redirects, and configure DNS
before traffic. Production builds emit HSTS and CSP without `unsafe-eval`;
Better Auth emits Secure, HttpOnly, SameSite cookies. A controlled proxy may set
`SECURITY_TRUST_PROXY_HEADERS=true` only when it overwrites forwarded headers.

Production email requires a verified sender domain and operational SPF, DKIM,
and DMARC review. Staging must use disabled delivery, the development provider,
or a provider sandbox with controlled recipients. Transactional email consent
must not be reused for marketing. Stripe webhook endpoints and prices are
created manually in the corresponding test/live account; the application never
creates live Stripe resources during deployment.
